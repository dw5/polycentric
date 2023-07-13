import * as React from 'react';
import * as Core from '@polycentric/polycentric-core';
import * as Claim from './Claim';
import { ParsedEvent, loadImageFromPointer } from './util';

function loadProfileProps(
    cancelContext: Core.CancelContext.CancelContext,
    processHandle: Core.ProcessHandle.ProcessHandle,
    queryManager: Core.Queries.QueryManager.QueryManager,
    system: Core.Models.PublicKey.PublicKey,
    setProfileProps: (f: (state: State) => State) => void,
): Core.Queries.Shared.UnregisterCallback {
    const queries: Array<Core.Queries.Shared.UnregisterCallback> = [];

    queries.push(
        queryManager.queryCRDT.query(
            system,
            Core.Models.ContentType.ContentTypeUsername,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    console.log('setting username');
                    setProfileProps((state) => {
                        return {
                            ...state,
                            name: Core.Util.decodeText(buffer),
                        };
                    });
                }
            },
        ),
    );

    queries.push(
        queryManager.queryCRDT.query(
            system,
            Core.Models.ContentType.ContentTypeDescription,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    console.log('setting description');
                    setProfileProps((state) => {
                        return {
                            ...state,
                            description: Core.Util.decodeText(buffer),
                        };
                    });
                }
            },
        ),
    );

    const loadAvatar = async (
        cancelContext: Core.CancelContext.CancelContext,
        avatarCancelContext: Core.CancelContext.CancelContext,
        pointer: Core.Models.Pointer.Pointer,
    ): Promise<void> => {
        const link = await loadImageFromPointer(processHandle, pointer);

        if (cancelContext.cancelled() || avatarCancelContext.cancelled()) {
            return;
        }

        console.log('setting avatar');

        setProfileProps((state) => {
            return {
                ...state,
                avatar: link,
            };
        });
    };

    let avatarCancelContext: Core.CancelContext.CancelContext | undefined =
        undefined;

    const avatarCallback = (buffer: Uint8Array) => {
        if (cancelContext.cancelled()) {
            return;
        }

        const pointer = Core.Models.Pointer.fromBuffer(buffer);

        if (avatarCancelContext !== undefined) {
            avatarCancelContext.cancel();
        }

        avatarCancelContext = new Core.CancelContext.CancelContext();

        loadAvatar(cancelContext, avatarCancelContext, pointer);
    };

    queries.push(
        queryManager.queryCRDT.query(
            system,
            Core.Models.ContentType.ContentTypeAvatar,
            avatarCallback,
        ),
    );

    {
        const cb = (value: Core.Queries.QueryIndex.CallbackParameters) => {
            const parsedEvents = value.add.map((raw) => {
                const signedEvent = Core.Models.SignedEvent.fromProto(raw);
                const event = Core.Models.Event.fromBuffer(signedEvent.event);

                if (
                    !event.contentType.equals(
                        Core.Models.ContentType.ContentTypeClaim,
                    )
                ) {
                    throw new Error('event content type was not claim');
                }

                const claim = Core.Protocol.Claim.decode(event.content);

                return new ParsedEvent<Core.Protocol.Claim>(
                    signedEvent,
                    event,
                    claim,
                );
            });

            if (cancelContext.cancelled()) {
                return;
            }

            console.log('setting claims');

            setProfileProps((state) => {
                return {
                    ...state,
                    claims: parsedEvents,
                };
            });
        };

        queries.push(
            queryManager.queryIndex.query(
                system,
                Core.Models.ContentType.ContentTypeClaim,
                cb,
            ),
        );

        queryManager.queryIndex.advance(system, cb, 10);
    }

    return () => {
        queries.forEach((f) => f());
    };
}

export type ProfileProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    queryManager: Core.Queries.QueryManager.QueryManager;
    system: Core.Models.PublicKey.PublicKey;
};

type State = {
    name: string;
    description: string;
    avatar: string;
    claims: Array<ParsedEvent<Core.Protocol.Claim>>;
};

const initialState = {
    name: 'loading',
    description: 'loading',
    claims: [],
    avatar: '',
};

export function Profile(props: ProfileProps) {
    const [state, setState] = React.useState<State>(initialState);

    React.useEffect(() => {
        setState(initialState);

        const cancelContext = new Core.CancelContext.CancelContext();

        const cleanupView = loadProfileProps(
            cancelContext,
            props.processHandle,
            props.queryManager,
            props.system,
            setState,
        );

        return () => {
            cancelContext.cancel();

            cleanupView();
        };
    }, [props.processHandle, props.queryManager, props.system]);


    const isSocialProp = (claim: ParsedEvent<Core.Protocol.Claim>) => {
        return (
            claim.value.claimType === Core.Models.ClaimType.Twitter ||
            claim.value.claimType === Core.Models.ClaimType.YouTube ||
            claim.value.claimType === Core.Models.ClaimType.Rumble ||
            claim.value.claimType === Core.Models.ClaimType.Bitcoin
        );
    };

    const socialClaims = state.claims.filter(
        (claim) => isSocialProp(claim) === true,
    );
    const otherClaims = state.claims.filter(
        (claim) => isSocialProp(claim) === false,
    );

    return (
        <div className="bg-white dark:bg-zinc-900 px-11 py-20 w-full max-w-3xl dark:text-white">
            <div className="bg-zinc-100 dark:bg-zinc-800 py-28 px-9 rounded-3xl shadow">
                <div className="flex flex-col items-center justify-center text-center gap-5">
                    <img
                        className="rounded-full w-20 h-20"
                        src={
                            state.avatar == '' || state.avatar == null
                                ? '/placeholder.jpg'
                                : state.avatar
                        }
                        alt={`The avatar for ${state.name}`}
                    />
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
                        {state.name}
                    </h1>

                    <h2 className="text-2xl font-light px-36">
                        {state.description}
                    </h2>
                    {socialClaims.length > 0 && (
                        <div>
                            <div className="flex flex-row justify-center px-7 gap-5 bg-gray-50 dark:bg-zinc-900 rounded-full py-4">
                                {socialClaims.map((claim, idx) => (
                                    <Claim.SocialClaim
                                        key={idx}
                                        parsedEvent={claim}
                                        processHandle={props.processHandle}
                                        queryManager={props.queryManager}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <br />

                <div className="px-6 py-5 bg-gray-50 dark:bg-zinc-900 rounded-lg">
                    <h2 className="text-3xl font-demibold text-gray-800 dark:text-white pb-4">
                        Claims
                    </h2>

                    {otherClaims.map((claim, idx) => (
                        <Claim.Claim
                            key={idx}
                            parsedEvent={claim}
                            processHandle={props.processHandle}
                            queryManager={props.queryManager}
                        />
                    ))}
                    {otherClaims.length == 0 && (
                        <div className="text-gray-400 dark:text-gray-600">
                            No claims yet!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
