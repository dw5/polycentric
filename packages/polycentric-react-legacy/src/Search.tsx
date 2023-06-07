import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';

import * as Core from '@polycentric/polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import { DispatchCardMemo } from './DispatchCard';

type SearchProps = {
    state: Core.DB.PolycentricState;
};

function Search(props: SearchProps) {
    const params = useParams();
    const [search, setSearch] = useState<string>('');
    const [searchResult, setSearchResult] = useState<
        [string, Core.Protocol.Pointer][]
    >([]);
    const [searchActive, setSearchActive] = useState<boolean>(false);
    const [submittedOnce, setSubmittedOnce] = useState<boolean>(false);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
    };

    const handleSubmitCore = async (topic: string) => {
        if (topic.length === 0) {
            return;
        }

        setSubmittedOnce(true);
        setSearchActive(true);
        setSearchResult([]);

        const responses = await Core.DB.search(props.state, topic);

        for (const response of responses) {
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].resultEvents,
            );
        }

        let filteredPosts: [string, Core.Protocol.Pointer][] = [];

        for (const response of responses) {
            for (const event of response[1].resultEvents) {
                filteredPosts.push([
                    response[0],
                    {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                ]);
            }
        }

        setSearchResult(filteredPosts);
        setSearchActive(false);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        handleSubmitCore(search);
    };

    useEffect(() => {
        if (params.search !== undefined) {
            setSearch(params.search);

            handleSubmitCore(params.search);
        }
    }, [params]);

    return (
        <div className="standard_width">
            <Paper
                elevation={4}
                style={{
                    marginBottom: '15px',
                    padding: '10px',
                    display: 'flex',
                }}
            >
                <form
                    onSubmit={handleSubmit}
                    style={{
                        width: '100%',
                    }}
                >
                    <TextField
                        value={search}
                        onChange={handleSearchChange}
                        label="Search"
                        variant="standard"
                        style={{
                            width: '100%',
                        }}
                    />
                </form>
            </Paper>

            {searchResult.map((post) => {
                const raw = post[0];
                const item = post[1];

                return (
                    <DispatchCardMemo
                        key={Base64.encode(Core.Keys.pointerToKey(item))}
                        state={props.state}
                        pointer={item}
                        fromServer={raw}
                    />
                );
            })}

            {searchResult.length === 0 && !searchActive && submittedOnce && (
                <Paper
                    elevation={4}
                    style={{
                        marginTop: '15px',
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> Nothing was found matching this query </h3>
                </Paper>
            )}

            {searchActive && (
                <div
                    style={{
                        width: '80%',
                        marginTop: '15px',
                        marginBottom: '15px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    }}
                >
                    <LinearProgress />
                </div>
            )}
        </div>
    );
}

export default Search;
