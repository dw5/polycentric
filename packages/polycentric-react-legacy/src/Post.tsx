import {
    Avatar,
    Button,
    Paper,
    IconButton,
    Menu,
    MenuItem,
    Typography,
    Table,
    TableBody,
    TableRow,
    TableCell,
    Divider,
} from '@mui/material';
import LoadingButton from '@mui/lab/LoadingButton';
import { Link } from 'react-router-dom';
import React, { useState, useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReplyIcon from '@mui/icons-material/Reply';
import LoopIcon from '@mui/icons-material/Loop';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import ImageViewer from 'react-simple-image-viewer';
import CloseIcon from '@mui/icons-material/Close';
import * as Base64 from '@borderless/base64';
import * as Lodash from 'lodash';
import getYouTubeID from 'get-youtube-id';
import Modal from 'react-modal';

import * as Core from '@polycentric/polycentric-core';
import * as Feed from './Feed';
import * as Explore from './Explore';
import PostModal from './PostModal';
import './Post.css';
import * as ProfileUtil from './ProfileUtil';
import { useImageViewerContext } from './ImageViewerContext';

export type DisplayablePost = {
    event: Core.Protocol.Event;
    pointer: Core.Protocol.Pointer;
    actionPointer: Core.Protocol.Pointer;
    profile: ProfileUtil.DisplayableProfile;
    message: string;
    image?: string;
    unixMilliseconds: number;
    sortMilliseconds: number;
    author: boolean;
    boost: DisplayablePost | undefined;
    fromServer?: string;
    boostedBy?: string;
};

type PostProps = {
    state: Core.DB.PolycentricState;
    post: DisplayablePost;
    showBoost: boolean;
    depth: number;
};

export type PostLoaderProps = {
    state: Core.DB.PolycentricState;
    pointer: Core.Protocol.Pointer;
    initialPost: DisplayablePost | undefined;
    showBoost: boolean;
    depth: number;
    dependencyContext: Core.DB.DependencyContext;
    cache: Explore.Cache;
};

export async function eventToDisplayablePost(
    state: Core.DB.PolycentricState,
    profiles: Map<string, ProfileUtil.DisplayableProfile>,
    storageEvent: Core.Protocol.StorageTypeEvent,
    dependencyContext: Core.DB.DependencyContext,
    cache: Explore.Cache,
): Promise<DisplayablePost | undefined> {
    if (storageEvent.mutationPointer !== undefined) {
        return undefined;
    }

    if (storageEvent.event === undefined) {
        return undefined;
    }

    const event = storageEvent.event;

    const body = Core.Protocol.EventBody.decode(event.content);

    if (body.message === undefined) {
        return undefined;
    }

    let displayableProfile = undefined;

    {
        const authorPublicKey = Base64.encodeUrl(event.authorPublicKey);
        let existing = profiles.get(authorPublicKey);

        if (existing === undefined) {
            displayableProfile = await ProfileUtil.loadProfileOrFallback(
                state,
                event.authorPublicKey,
                dependencyContext,
            );

            profiles.set(authorPublicKey, displayableProfile);
        } else {
            displayableProfile = existing;
        }
    }

    const amAuthor = Core.Util.blobsEqual(
        state.identity!.publicKey,
        event.authorPublicKey,
    );

    const pointer = {
        publicKey: event.authorPublicKey,
        writerId: event.writerId,
        sequenceNumber: event.sequenceNumber,
    };

    if (body.message.image !== undefined) {
        dependencyContext.addDependency(body.message.image);
    }

    if (body.message.boostPointer !== undefined) {
        dependencyContext.addDependency(body.message.boostPointer);
    }

    // if this is a pure boost
    if (
        body.message.message.length === 0 &&
        body.message.image === undefined &&
        body.message.boostPointer !== undefined
    ) {
        const boost = await Core.DB.tryLoadStorageEventByPointer(
            state,
            body.message.boostPointer,
        );

        // display nothing for deleted subject
        if (boost !== undefined && boost.event === undefined) {
            return undefined;
        }

        if (boost !== undefined) {
            const displayable = await eventToDisplayablePost(
                state,
                profiles,
                boost,
                dependencyContext,
                cache,
            );

            if (displayable !== undefined) {
                displayable.pointer = pointer;
                displayable.boostedBy = displayableProfile.displayName;
                displayable.author = amAuthor;
                displayable.sortMilliseconds = event.unixMilliseconds;

                return displayable;
            }
        }
    }

    let displayable: DisplayablePost = {
        event: event,
        pointer: pointer,
        actionPointer: pointer,
        profile: displayableProfile,
        message: new TextDecoder().decode(body.message.message),
        unixMilliseconds: event.unixMilliseconds,
        sortMilliseconds: event.unixMilliseconds,
        author: amAuthor,
        boost: undefined,
    };

    if (body.message.boostPointer !== undefined) {
        const boost = await Core.DB.tryLoadStorageEventByPointer(
            state,
            body.message.boostPointer,
        );

        if (boost !== undefined) {
            displayable.boost = await eventToDisplayablePost(
                state,
                profiles,
                boost,
                dependencyContext,
                cache,
            );
        }
    }

    if (body.message.image !== undefined) {
        const existingLink = cache.getImageLink(body.message.image);

        if (existingLink !== undefined) {
            displayable.image = existingLink;
        } else {
            const loaded = await Core.DB.loadBlob(
                state,
                body.message.image,
                dependencyContext,
            );

            if (loaded !== undefined) {
                displayable.image = cache.addImage(
                    body.message.image,
                    new Blob([loaded.blob], {
                        type: loaded.kind,
                    }),
                );
            }
        }
    }

    return displayable;
}

export async function tryLoadDisplayable(
    state: Core.DB.PolycentricState,
    pointer: Core.Protocol.Pointer,
    dependencyContext: Core.DB.DependencyContext,
    cache: Explore.Cache,
) {
    dependencyContext.addDependency(pointer);

    const event = await Core.DB.tryLoadStorageEventByPointer(state, pointer);

    if (event === undefined || event.event === undefined) {
        return undefined;
    }

    const body = Core.Protocol.EventBody.decode(event.event.content);

    const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

    const displayable = await eventToDisplayablePost(
        state,
        profiles,
        {
            event: event.event,
            mutationPointer: undefined,
        },
        dependencyContext,
        cache,
    );

    return displayable;
}

export const PostLoaderMemo = memo(PostLoader);

export function PostLoader(props: PostLoaderProps) {
    const [displayable, setDisplayable] = useState<DisplayablePost | undefined>(
        props.initialPost,
    );

    const loadCard = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        if (cancelContext.cancelled()) {
            return;
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const displayable = await tryLoadDisplayable(
            props.state,
            props.pointer,
            dependencyContext,
            props.cache,
        );

        if (cancelContext.cancelled()) {
            dependencyContext.cleanup();
            return;
        }

        const recurse = () => {
            dependencyContext.setHandler(
                Lodash.once(() => {
                    dependencyContext.cleanup();
                    loadCard(cancelContext);
                }),
            );
        };

        if (displayable !== undefined && props.initialPost !== undefined) {
            displayable.fromServer = props.initialPost.fromServer;
        }

        setDisplayable(displayable);

        recurse();
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        props.dependencyContext.setHandler(
            Lodash.once(() => {
                loadCard(cancelContext);
            }),
        );

        return () => {
            cancelContext.cancel();
        };
    }, []);

    if (displayable !== undefined) {
        return (
            <Post
                state={props.state}
                post={displayable}
                showBoost={props.showBoost}
                depth={props.depth}
            />
        );
    } else {
        return <div />;
    }
}

function processText(message: string) {
    let position = 0;
    return (
        <React.Fragment>
            {message.split(/(\s+)/g).map((section: string) => {
                if (section.startsWith('#')) {
                    position++;
                    return (
                        <span key={position.toString()}>
                            <Link
                                className="hashTag"
                                to={`/search/${encodeURIComponent(section)}`}
                            >
                                {section}
                            </Link>
                            &nbsp;
                        </span>
                    );
                } else if (
                    section.startsWith('https://') ||
                    section.startsWith('http://')
                ) {
                    position++;
                    return (
                        <span key={position.toString()}>
                            <a href={section} target="_blank">
                                {section}
                            </a>
                        </span>
                    );
                } else {
                    return section;
                }
            })}
        </React.Fragment>
    );
}

function postToLink(post: DisplayablePost): string {
    const pointer = post.pointer;

    const username = post.profile.displayName;

    return (
        'feed/' +
        username +
        '/' +
        Base64.encodeUrl(
            Core.Protocol.URLInfo.encode({
                publicKey: pointer.publicKey,
                writerId: pointer.writerId,
                sequenceNumber: pointer.sequenceNumber,
                servers: post.profile.servers,
            }).finish(),
        )
    );
}

type PostDebugModalProps = {
    state: Core.DB.PolycentricState;
    isOpen: boolean;
    onClose: () => void;
    pointer: Core.Protocol.Pointer;
};

const customStyles = {
    content: {
        top: '20%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        minWidth: '25%',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
    },
    overlay: {
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1300,
    },
};

function PostDebugModal(props: PostDebugModalProps) {
    const [event, setEvent] = useState<Core.Protocol.Event | undefined>(
        undefined,
    );

    async function load() {
        const potentialEvent = await Core.DB.tryLoadStorageEventByPointer(
            props.state,
            props.pointer,
        );

        if (
            potentialEvent === undefined ||
            potentialEvent.event === undefined
        ) {
            return;
        }

        setEvent(potentialEvent.event);
    }

    useEffect(() => {
        if (props.isOpen === true) {
            load();
        }
    }, [props.state, props.isOpen, props.pointer]);

    return (
        <Modal isOpen={props.isOpen} style={customStyles}>
            <CloseIcon
                onClick={props.onClose}
                style={{
                    position: 'absolute',
                    right: '5px',
                    top: '5px',
                }}
            />

            <Divider>Clocks</Divider>
            <Table>
                <TableBody>
                    {event &&
                        event.clocks.map((item, index) => (
                            <TableRow key={index}>
                                <TableCell
                                    style={{
                                        wordBreak: 'break-all',
                                        fontFamily: 'monospace',
                                    }}
                                >
                                    {Base64.encodeUrl(item.key)}
                                </TableCell>
                                <TableCell>{item.value}</TableCell>
                            </TableRow>
                        ))}
                </TableBody>
            </Table>
        </Modal>
    );
}

export const PostMemo = memo(Post);

export function Post(props: PostProps) {
    let navigate = useNavigate();

    const [modalIsOpen, setModalIsOpen] = useState(false);
    const [boosting, setBoosting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [youtubeLink, setYoutubeLink] = useState<string | undefined>(
        undefined,
    );
    const [anchor, setAnchor] = useState<null | HTMLElement>(null);

    const [debugModalIsOpen, setDebugModalIsOpen] = useState(false);

    const { setViewerLink } = useImageViewerContext();

    const handleBoost = async (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        if (boosting === true) {
            return;
        }

        setBoosting(true);

        const event = Core.DB.makeDefaultEventBody();
        event.message = {
            message: new Uint8Array(),
            boostPointer: props.post.actionPointer,
        };

        await Core.DB.levelSavePost(props.state, event);

        setTimeout(() => {
            setBoosting(false);
        }, 500);
    };

    const handleDelete = async (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        setDeleting(true);

        await Core.DB.deletePost(props.state, props.post.pointer);
    };

    const handleNavigate = (event: React.MouseEvent<HTMLDivElement>) => {
        navigate('/' + postToLink(props.post));
    };

    const handleBackgroundClick = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();

        navigate('/' + postToLink(props.post));
    };

    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchor(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchor(null);
    };

    useEffect(() => {
        props.post.message.split(/(\s+)/g).map((section: string) => {
            const parsed = getYouTubeID(section, { fuzzy: false });

            if (parsed !== null) {
                setYoutubeLink('https://www.youtube.com/embed/' + parsed);
            }
        });
    }, [props.post]);

    return (
        <Paper
            elevation={4}
            style={{
                marginBottom: '15px',
                overflow: 'auto',
                position: 'relative',
                pointerEvents: 'auto',
            }}
        >
            <PostDebugModal
                state={props.state}
                isOpen={debugModalIsOpen}
                onClose={() => {
                    setDebugModalIsOpen(false);
                }}
                pointer={props.post.pointer}
            />

            <div
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                <PostModal
                    state={props.state}
                    isOpen={modalIsOpen}
                    onClose={() => {
                        setModalIsOpen(false);
                    }}
                    boostPointer={props.post.actionPointer}
                />
            </div>

            <div
                style={{
                    position: 'absolute',
                    left: '0px',
                    top: '0px',
                    height: '100%',
                    width: '100%',
                    zIndex: 0,
                }}
                className="highlight_on_hover"
                onClick={handleBackgroundClick}
            />

            <div
                style={{
                    zIndex: 1,
                    position: 'relative',
                    pointerEvents: 'none',
                }}
            >
                {props.post.fromServer !== undefined && (
                    <div
                        style={{
                            margin: '10px',
                            marginTop: '5px',
                            marginBottom: '0px',
                            fontSize: '11px',
                        }}
                    >
                        Recommended By: &nbsp;
                        <span
                            style={{
                                color: 'gray',
                                fontWeight: 600,
                            }}
                        >
                            {props.post.fromServer}
                        </span>
                        <div
                            style={{
                                width: '99%',
                                marginTop: '5px',
                                marginLeft: 'auto',
                                marginRight: 'auto',
                                borderBottom: '1px solid gray',
                            }}
                        />
                    </div>
                )}

                {props.post.boostedBy !== undefined && (
                    <div
                        style={{
                            margin: '10px',
                            marginTop: '5px',
                            marginBottom: '0px',
                            fontSize: '11px',
                        }}
                    >
                        Boosted By: &nbsp;
                        <span
                            style={{
                                color: 'gray',
                                fontWeight: 600,
                            }}
                        >
                            {props.post.boostedBy}
                        </span>
                        <div
                            style={{
                                width: '99%',
                                marginTop: '5px',
                                marginLeft: 'auto',
                                marginRight: 'auto',
                                borderBottom: '1px solid gray',
                            }}
                        />
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                    }}
                >
                    <Avatar
                        src={props.post.profile.avatar}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (props.post.profile.avatar !== undefined) {
                                setViewerLink(props.post.profile.avatar);
                            }
                        }}
                        style={{
                            marginTop: '11px',
                            marginLeft: '8px',
                            marginRight: '8px',
                            pointerEvents: 'auto',
                        }}
                    />

                    <div
                        style={{
                            flex: '1',
                            marginTop: '11px',
                            marginRight: '10px',
                            marginBottom: '10px',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                            }}
                        >
                            <div
                                className="underline_on_hover"
                                style={{
                                    alignSelf: 'flex-start',
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    pointerEvents: 'auto',
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate('/' + props.post.profile.link);
                                }}
                            >
                                <h3
                                    style={{
                                        alignSelf: 'flex-start',
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                        wordBreak: 'break-all',
                                        marginTop: '0px',
                                        marginBottom: '0px',
                                        fontSize: '15px',
                                        lineHeight: '15px',
                                    }}
                                >
                                    {props.post.profile.displayName}
                                </h3>
                                <span
                                    style={{
                                        alignSelf: 'flex-start',
                                        fontWeight: '600',
                                        wordBreak: 'break-all',
                                        fontSize: '9px',
                                        lineHeight: '9px',
                                        color: 'gray',
                                        fontFamily: 'monospace',
                                        marginTop: '7px',
                                    }}
                                >
                                    @{props.post.profile.identity}
                                </span>
                            </div>

                            {props.showBoost === true && (
                                <IconButton
                                    color="primary"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenMenu(e);
                                    }}
                                    style={{
                                        pointerEvents: 'auto',
                                    }}
                                >
                                    <MoreHorizIcon
                                        style={{
                                            color: 'gray',
                                        }}
                                    />
                                </IconButton>
                            )}

                            <Menu
                                sx={{ mt: '45px' }}
                                anchorEl={anchor}
                                open={Boolean(anchor)}
                                onClose={handleCloseMenu}
                                anchorOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                keepMounted
                                transformOrigin={{
                                    vertical: 'top',
                                    horizontal: 'right',
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                }}
                            >
                                <MenuItem
                                    onClick={() => {
                                        setDebugModalIsOpen(true);
                                        setAnchor(null);
                                    }}
                                >
                                    <Typography textAlign="center">
                                        Debug Info
                                    </Typography>
                                </MenuItem>
                                {props.post.author && (
                                    <MenuItem onClick={handleDelete}>
                                        <Typography textAlign="center">
                                            Delete Post
                                        </Typography>
                                    </MenuItem>
                                )}
                            </Menu>
                        </div>

                        {props.post.boost !== undefined && props.depth >= 1 && (
                            <p
                                onClick={handleNavigate}
                                className="underline_on_hover"
                                style={{
                                    alignSelf: 'flex-start',
                                    whiteSpace: 'pre-wrap',
                                    marginTop: '7px',
                                    marginBottom: '5px',
                                    fontSize: '9px',
                                    lineHeight: '9px',
                                    overflowWrap: 'anywhere',
                                    pointerEvents: 'auto',
                                }}
                            >
                                <span
                                    style={{
                                        color: 'gray',
                                    }}
                                >
                                    Reacting to:{' '}
                                </span>
                                <span
                                    style={{
                                        fontWeight: 'bold',
                                    }}
                                >
                                    {props.post.boost.profile.displayName}
                                </span>
                            </p>
                        )}

                        {props.post.message !== '' && (
                            <p
                                style={{
                                    alignSelf: 'flex-start',
                                    whiteSpace: 'pre-wrap',
                                    marginTop: '2px',
                                    marginBottom: '5px',
                                    fontSize: '15px',
                                    overflowWrap: 'anywhere',
                                    pointerEvents: 'auto',
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                }}
                            >
                                {processText(props.post.message)}
                            </p>
                        )}

                        {youtubeLink !== undefined && (
                            <iframe
                                src={youtubeLink}
                                frameBorder="0"
                                allow={
                                    'accelerometer; autoplay; ' +
                                    'clipboard-write; ' +
                                    'encrypted-media; ' +
                                    'gyroscope; ' +
                                    'picture-in-picture'
                                }
                                allowFullScreen
                                title="Embedded youtube"
                                style={{
                                    maxHeight: '500px',
                                    minHeight: '300px',
                                    marginTop: '10px',
                                    alignSelf: 'center',
                                    width: '100%',
                                    pointerEvents: 'auto',
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                }}
                            />
                        )}

                        {props.post.image !== undefined && (
                            <img
                                src={props.post.image}
                                alt="Within Post"
                                style={{
                                    marginTop: '4px',
                                    maxHeight: '500px',
                                    maxWidth: '100%',
                                    alignSelf: 'center',
                                    pointerEvents: 'auto',
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (props.post.image !== undefined) {
                                        setViewerLink(props.post.image);
                                    }
                                }}
                            />
                        )}

                        {props.post.boost !== undefined && props.depth < 1 && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    pointerEvents: 'none',
                                }}
                            >
                                <Post
                                    state={props.state}
                                    post={props.post.boost}
                                    showBoost={false}
                                    depth={props.depth + 1}
                                />
                            </div>
                        )}

                        <p
                            style={{
                                fontWeight: '600',
                                fontSize: '12px',
                                color: 'gray',
                                marginTop: '6px',
                                alignSelf: 'flex-start',
                                pointerEvents: 'auto',
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            Posted on: &nbsp;
                            {new Date(
                                props.post.unixMilliseconds,
                            ).toLocaleString()}
                        </p>

                        {props.showBoost === true && (
                            <div
                                style={{
                                    display: 'flex',
                                    columnGap: '5px',
                                    alignSelf: 'flex-start',
                                    pointerEvents: 'auto',
                                }}
                            >
                                <LoadingButton
                                    loading={boosting}
                                    variant="contained"
                                    onClick={handleBoost}
                                    loadingPosition="start"
                                    startIcon={<LoopIcon />}
                                    size="small"
                                >
                                    Boost
                                </LoadingButton>
                                <Button
                                    variant="contained"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setModalIsOpen(true);
                                    }}
                                    startIcon={<ReplyIcon />}
                                    size="small"
                                >
                                    React
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Paper>
    );
}

export default Post;
