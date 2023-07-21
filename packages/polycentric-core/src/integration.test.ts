import Long from 'long';

import * as FS from 'fs';
import * as Base64 from '@borderless/base64';
import * as ProcessHandle from './process-handle';
import * as MetaStore from './meta-store';
import * as PersistenceDriver from './persistence-driver';
import * as Models from './models';
import * as Synchronization from './synchronization';
import * as Protocol from './protocol';
import * as APIMethods from './api-methods';
import * as Util from './util';
import { protoSystemStateToSystemState, updateSystemState } from './process-handle';

const TEST_SERVER = 'http://127.0.0.1:8081';
// const TEST_SERVER = 'https://srv1-stg.polycentric.io';

export async function createProcessHandle(): Promise<ProcessHandle.ProcessHandle> {
    return await ProcessHandle.createProcessHandle(
        await MetaStore.createMetaStore(
            PersistenceDriver.createPersistenceDriverMemory(),
        ),
    );
}

async function fullSync(handle: ProcessHandle.ProcessHandle) {
    while (await Synchronization.backFillServers(handle, handle.system())) {}
}

async function createHandleWithName(username: string) {
    const s1p1 = await createProcessHandle();
    await s1p1.addServer(TEST_SERVER);
    await s1p1.setUsername(username);
    await Synchronization.backFillServers(s1p1, s1p1.system());
    return s1p1;
}

describe('integration', () => {
    test('sync', async () => {
        const s1p1 = await createProcessHandle();
        await s1p1.addServer(TEST_SERVER);
        await s1p1.setDescription('hello');

        const claim = Models.claimHackerNews('pg');

        const claimPointer = await s1p1.claim(claim);
        await s1p1.vouch(claimPointer);

        await Synchronization.backFillServers(s1p1, s1p1.system());

        const s2p1 = await createProcessHandle();

        while (
            await Synchronization.backfillClient(
                s2p1,
                s1p1.system(),
                TEST_SERVER,
            )
        ) {}

        const s1State = await s2p1.loadSystemState(s1p1.system());

        expect(s1State.description()).toStrictEqual('hello');

        const resolved = await APIMethods.getResolveClaim(
            TEST_SERVER,
            s1p1.system(),
            claim,
        );

        expect(resolved.events.length).toStrictEqual(2);
    });

    test('resolveAndQuery', async () => {
        const s1p1 = await createProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        await s1p1.setUsername('Louis Rossmann');
        await s1p1.setDescription('Apple and Apple accesories');

        console.log(
            'rossmann system:' +
                (await ProcessHandle.makeSystemLink(s1p1, s1p1.system())),
        );

        const claimPointer = await s1p1.claim(
            Models.claimGeneric('I Can Lift 4pl8'),
        );

        await s1p1.vouch(claimPointer);

        await s1p1.claim(Models.claimYouTube('@rossmanngroup'));
        await s1p1.claim(Models.claimTwitter('fighttorepair'));
        await s1p1.claim(
            Models.claimBitcoin('1EaEv8DBeFfg6fE6BimEmvEFbYLkhpcvhj'),
        );

        {
            const image = FS.readFileSync('./src/rossmann.jpg', null);
            const imagePointer = await s1p1.publishBlob('image/jpeg', image);
            await s1p1.setAvatar(imagePointer);
        }

        await Synchronization.backFillServers(s1p1, s1p1.system());

        const s2p1 = await createProcessHandle();
        await s2p1.addServer(TEST_SERVER);

        await s2p1.setUsername('Futo');
        await s2p1.setDescription('Tech Freedom');
        await s2p1.vouch(claimPointer);

        {
            const image = FS.readFileSync('./src/futo.jpg', null);
            const imagePointer = await s2p1.publishBlob('image/jpeg', image);
            await s2p1.setAvatar(imagePointer);
        }

        await Synchronization.backFillServers(s2p1, s2p1.system());

        // console.log('futo system:' + systemToBase64(s2p1.system()));
    });

    test('like', async () => {
        const subject = Models.bufferToReference(
            Util.encodeText('https://fake2.com/' + Math.random().toString()),
        );

        const shamir = await createHandleWithName('shamir');
        const bernstein = await createHandleWithName('bernstein');

        // query likes / dislikes from a server
        const getLikesAndDislikes = async () => {
            const queryReferences = await APIMethods.getQueryReferences(
                TEST_SERVER,
                subject,
                undefined,
                {
                    fromType: Models.ContentType.ContentTypePost,
                    countLwwElementReferences: [],
                    countReferences: [],
                },
                [
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionLike,
                    },
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionDislike,
                    },
                ],
            );

            expect(queryReferences.counts).toHaveLength(2);

            return {
                likes: queryReferences.counts[0].toNumber(),
                dislikes: queryReferences.counts[1].toNumber(),
            };
        };

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 0,
            dislikes: 0,
        });

        await bernstein.opinion(subject, Models.Opinion.OpinionLike);
        await fullSync(bernstein);

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 1,
            dislikes: 0,
        });

        await shamir.opinion(subject, Models.Opinion.OpinionLike);
        await fullSync(shamir);

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 2,
            dislikes: 0,
        });

        await bernstein.opinion(subject, Models.Opinion.OpinionDislike);
        await fullSync(bernstein);

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 1,
            dislikes: 1,
        });

        await bernstein.opinion(subject, Models.Opinion.OpinionNeutral);
        await fullSync(bernstein);

        await shamir.opinion(subject, Models.Opinion.OpinionNeutral);
        await fullSync(shamir);

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 0,
            dislikes: 0,
        });
    });

    test('usernameChange', async () => {
        const processHandle = await createHandleWithName("test1");

        {
            const response = await APIMethods.getQueryIndex(TEST_SERVER, processHandle.system(), Models.ContentType.ContentTypeUsername);
            const systemState = Protocol.StorageTypeSystemState.create();
            for (const ev of response.events) {
                const se = Models.SignedEvent.fromProto(ev);
                updateSystemState(systemState, Models.Event.fromBuffer(se.event));
            }

            const state = protoSystemStateToSystemState(systemState);
            expect(state.username()).toStrictEqual("test1");
        }

        await processHandle.setUsername("test2");
        await Synchronization.backFillServers(processHandle, processHandle.system());

        {
            const response = await APIMethods.getQueryIndex(TEST_SERVER, processHandle.system(), Models.ContentType.ContentTypeUsername);
            const systemState = Protocol.StorageTypeSystemState.create();
            for (const ev of response.events) {
                const se = Models.SignedEvent.fromProto(ev);
                updateSystemState(systemState, Models.Event.fromBuffer(se.event));
            }

            const state = protoSystemStateToSystemState(systemState);
            expect(state.username()).toStrictEqual("test2");
        }  
    });

    test('comment', async () => {
        const subject = Models.bufferToReference(
            Util.encodeText('https://fake.com/' + Math.random().toString()),
        );

        const vonNeumann = await createHandleWithName('Von Neumann');
        const godel = await createHandleWithName('Godel');
        const babbage = await createHandleWithName('Babbage');
        const turing = await createHandleWithName('Turing');

        let rootPosts: Array<Protocol.Reference> = [];

        // von neumann comments 5 times
        for (let i = 0; i < 5; i++) {
            rootPosts.push(
                Models.pointerToReference(
                    await vonNeumann.post(i.toString(), undefined, subject),
                ),
            );
        }

        // godel comments 10 times
        for (let i = 0; i < 10; i++) {
            rootPosts.push(
                Models.pointerToReference(
                    await godel.post(i.toString(), undefined, subject),
                ),
            );
        }

        // babbage likes the first three comments
        for (let i = 0; i < 3; i++) {
            await babbage.opinion(rootPosts[i], Models.Opinion.OpinionLike);
        }

        // babbage dislikes the last two comments
        for (let i = rootPosts.length - 2; i < rootPosts.length; i++) {
            await babbage.opinion(rootPosts[i], Models.Opinion.OpinionDislike);
        }

        // godel likes the first two comments
        for (let i = 0; i < 2; i++) {
            await godel.opinion(rootPosts[i], Models.Opinion.OpinionLike);
        }

        // godel dislikes the third comment
        await godel.opinion(rootPosts[2], Models.Opinion.OpinionDislike);

        // turing replies von neumanns comment three times
        for (let i = 0; i < 3; i++) {
            await turing.post(i.toString(), undefined, rootPosts[1]);
        }

        await fullSync(vonNeumann);
        await fullSync(godel);
        await fullSync(babbage);
        await fullSync(turing);

        // query comments from a server
        const queryReferences = await APIMethods.getQueryReferences(
            TEST_SERVER,
            subject,
            undefined,
            {
                fromType: Models.ContentType.ContentTypePost,
                countLwwElementReferences: [
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionLike,
                    },
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionDislike,
                    },
                ],
                countReferences: [
                    {
                        fromType: Models.ContentType.ContentTypePost,
                    },
                ],
            },
        );

        expect(queryReferences.items).toHaveLength(rootPosts.length);

        function referenceToString(reference: Protocol.Reference): string {
            return Base64.encode(Protocol.Reference.encode(reference).finish());
        }

        // API result order is not guaranteed so put items in a map
        const referenceToItem = new Map<
            string,
            Protocol.QueryReferencesResponseEventItem
        >();

        for (const item of queryReferences.items) {
            if (item.event === undefined) {
                throw new Error('expected event');
            }
            const signedEvent = Models.SignedEvent.fromProto(item.event);
            const pointer = await Models.signedEventToPointer(signedEvent);
            const reference = Models.pointerToReference(pointer);
            referenceToItem.set(referenceToString(reference), item);
        }

        function checkResult(
            i: number,
            likes: number,
            dislikes: number,
            replies: number,
        ) {
            const item = referenceToItem.get(referenceToString(rootPosts[i]));
            expect(item).toBeDefined();
            expect(item!.counts[0]).toStrictEqual(new Long(likes, 0, true));
            expect(item!.counts[1]).toStrictEqual(new Long(dislikes, 0, true));
            expect(item!.counts[2]).toStrictEqual(new Long(replies, 0, true));
        }

        // Ensure the API has the expected counts and events
        checkResult(0, 2, 0, 0);
        checkResult(1, 2, 0, 3);
        checkResult(2, 1, 1, 0);
        for (let i = 3; i < 13; i++) {
            checkResult(i, 0, 0, 0);
        }
        checkResult(13, 0, 1, 0);
        checkResult(14, 0, 1, 0);
    }, 10000);

    test('censor', async () => {
        const s1p1 = await createProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        let postContent = 'I fought the law, and the law won';
        await s1p1.post(postContent);

        let post = await s1p1.post(postContent);
        let censorSystem = await ProcessHandle.makeSystemLink(
            s1p1,
            s1p1.system(),
        );
        await APIMethods.postCensor(
            TEST_SERVER,
            Models.CensorshipType.DoNotRecommend,
            `https://localhost:8081/profile/${censorSystem}`,
            '123',
        );

        let censorEvent = await ProcessHandle.makeEventLink(
            s1p1,
            s1p1.system(),
            post,
        );
        await APIMethods.postCensor(
            TEST_SERVER,
            Models.CensorshipType.DoNotRecommend,
            `https://localhost:8081/post/${censorEvent}`,
            '123',
        );
    });

    test('search', async () => {
        function eventToContent(event: Uint8Array): string {
            let decodedEvent = Models.Event.fromBuffer(event);
            let post = Protocol.Post.decode(decodedEvent.content);
            if (post.content === undefined) {
                throw new Error('Post content was undefined');
            }
            return post.content;
        }

        function lwwEventToContent(event: Uint8Array): string {
            let decodedEvent = Models.Event.fromBuffer(event);
            if (decodedEvent.lwwElement === undefined) {
                throw new Error('LWW Element was undefined');
            }
            return Util.decodeText(decodedEvent.lwwElement.value);
        }

        function getAndCheckFirstEvent(
            searchResults: Protocol.ResultEventsAndRelatedEventsAndCursor,
        ): Uint8Array {
            let resultEvents = searchResults.resultEvents;
            if (resultEvents === undefined) {
                throw new Error('ResultEvents was undefined');
            }
            let events = resultEvents.events;
            expect(events.length).toBeGreaterThan(0);
            let signedEvent = events[0];
            return signedEvent.event;
        }

        const s1p1 = await createProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        let username = Math.random() * 100000 + '';
        let description = 'Alerts for many rail lines';
        let newUsername = 'South Eastern Pennsylvania Transportation Authority';
        await s1p1.setDescription(description);
        await s1p1.setUsername(newUsername);

        let post1Content =
            'The Manayunk/Norristown line is delayed 15 minutes due to trackwork';
        let post2Content =
            'All trains are on a reduced schedule due to single-tracking at Jefferson station';
        let post3Content = Math.random() * 100000 + '';
        await s1p1.post(post1Content);
        await s1p1.post(post2Content);

        for (let i = 0; i < 11; i++) {
            await s1p1.post(post3Content);
        }

        await Synchronization.backFillServers(s1p1, s1p1.system());

        // give opensearch time to index everything
        await new Promise((r) => setTimeout(r, 5000));

        let post1SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Manayunk',
        );
        let post1SearchContent = eventToContent(
            getAndCheckFirstEvent(post1SearchResults),
        );
        expect(post1SearchContent).toBe(post1Content);

        let post2SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Thomas Jefferson',
        );
        let post2SearchContent = eventToContent(
            getAndCheckFirstEvent(post2SearchResults),
        );
        expect(post2SearchContent).toBe(post2Content);

        let post3SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            post3Content,
        );
        let post3SearchContent = eventToContent(
            getAndCheckFirstEvent(post3SearchResults),
        );
        expect(post3SearchContent).toBe(post3Content);
        expect(post3SearchResults.resultEvents?.events.length).toBe(10);

        if (post3SearchResults.cursor === undefined) {
            throw new Error('post3SearchResults.cursor is undefined');
        }

        let post3ReSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            post3Content,
            post3SearchResults.cursor,
        );
        expect(post3ReSearchResults.resultEvents?.events.length).toBe(1);

        let usernameSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Pennsylvania',
        );
        let usernameSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(usernameSearchResults),
        );
        expect(usernameSearchContent).toBe(newUsername);

        let oldUsernameSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            username,
        );
        expect(oldUsernameSearchResults.resultEvents?.events.length).toBe(0);

        let descriptionSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Alerts',
        );
        let descriptionSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(descriptionSearchResults),
        );
        expect(descriptionSearchContent).toBe(description);
    }, 10000);
});
