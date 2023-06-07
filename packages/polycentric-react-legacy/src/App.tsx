import {
    Outlet,
    Link,
    NavLink,
    useNavigate,
    useLocation,
} from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
    AppBar,
    Toolbar,
    ThemeProvider,
    Tooltip,
    IconButton,
    Avatar,
    Box,
    Menu,
    MenuItem,
    Typography,
    Fab,
    createTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EditIcon from '@mui/icons-material/Edit';
import ImageViewer from 'react-simple-image-viewer';

import * as Core from '@polycentric/polycentric-core';
import PostModal from './PostModal';
import * as ProfileUtil from './ProfileUtil';
import './App.css';
import { ImageViewerContext } from './ImageViewerContext';

const theme = createTheme({
    palette: {
        primary: {
            main: '#3897D9',
        },
        secondary: {
            main: '#64D98A',
        },
        warning: {
            main: '#64D98A',
        },
        error: {
            main: '#8B0000',
        },
    },
});

type AppProps = {
    state: Core.DB.PolycentricState | undefined;
    metaStore: Core.PersistenceDriver.IMetaStore;
    setState: (state: Core.DB.PolycentricState | undefined) => void;
};

function App(props: AppProps) {
    const [modalIsOpen, setModalIsOpen] = useState(false);
    const [avatar, setAvatar] = useState<string | undefined>(undefined);
    const [anchor, setAnchor] = useState<null | HTMLElement>(null);
    const [viewerLink, setViewerLink] = useState<string | undefined>(undefined);

    const location = useLocation();
    const navigate = useNavigate();

    const handleOpenProfile = () => {
        navigate('/profile');
        setAnchor(null);
    };

    const handleOpenNotifications = () => {
        navigate('/notifications');
        setAnchor(null);
    };

    const handleOpenFollowing = () => {
        navigate('/following');
        setAnchor(null);
    };

    const handleOpenAbout = () => {
        navigate('/about');
        setAnchor(null);
    };

    const handleSwitchProfile = async () => {
        await props.metaStore.unsetActiveStore();
        props.setState(undefined);
        navigate('/profiles');
        setAnchor(null);
    };

    const handleOpenMyPosts = () => {
        if (props.state !== undefined && props.state.identity !== undefined) {
            navigate(
                '/' +
                    ProfileUtil.profileToLinkOnlyKey(
                        props.state.identity.publicKey,
                    ),
            );
            setAnchor(null);
        }
    };

    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchor(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchor(null);
    };

    const handleOpenPostModal = () => {
        setModalIsOpen(true);
    };

    const loadProfileImage = async (state: Core.DB.PolycentricState) => {
        const profile = await Core.DB.loadProfile(state);

        if (profile.imagePointer === undefined) {
            return;
        }

        const dependencyContext = new Core.DB.DependencyContext(state);

        const loaded = await Core.DB.loadBlob(
            state,
            profile.imagePointer,
            dependencyContext,
        );

        dependencyContext.cleanup();

        if (loaded === undefined) {
            return;
        }

        setAvatar(Core.Util.blobToURL(loaded.kind, loaded.blob));
    };

    useEffect(() => {
        if (props.state === undefined) {
            return;
        }

        const state = props.state;

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            if (props.state !== undefined) {
                loadProfileImage(state);
            }
        };

        state.level.on('put', handlePut);

        loadProfileImage(state);

        return () => {
            state.level.removeListener('put', handlePut);
        };
    }, [props.state]);

    const activeStyle = {
        textDecoration: 'underline',
    };

    return (
        <div>
            <ThemeProvider theme={theme}>
                <ImageViewerContext.Provider value={{ setViewerLink }}>
                    {viewerLink && (
                        <ImageViewer
                            src={[viewerLink]}
                            currentIndex={0}
                            closeOnClickOutside={true}
                            onClose={() => {
                                setViewerLink(undefined);
                            }}
                            backgroundStyle={{
                                backgroundColor: 'rgba(0,0,0,0.5)',
                                zIndex: 1300,
                            }}
                        />
                    )}

                    {props.state && props.state.identity !== undefined && (
                        <AppBar position="sticky">
                            <Toolbar>
                                <Box className="app__header">
                                    <NavLink
                                        to="/explore"
                                        style={({ isActive }) =>
                                            isActive ? activeStyle : {}
                                        }
                                    >
                                        Explore
                                    </NavLink>
                                    <NavLink
                                        to="/"
                                        style={({ isActive }) =>
                                            isActive ? activeStyle : {}
                                        }
                                    >
                                        Feed
                                    </NavLink>
                                    <NavLink
                                        to="/search"
                                        style={({ isActive }) =>
                                            isActive ? activeStyle : {}
                                        }
                                    >
                                        Search
                                    </NavLink>
                                </Box>
                                <Box sx={{ flexGrow: 1 }} />
                                <Box>
                                    <Tooltip title="Open Notifications">
                                        <IconButton
                                            onClick={handleOpenNotifications}
                                            sx={{
                                                p: 0,
                                                marginRight: '15px',
                                            }}
                                            size="large"
                                            color="inherit"
                                        >
                                            <NotificationsIcon />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Open Menu">
                                        <IconButton
                                            onClick={handleOpenMenu}
                                            sx={{ p: 0 }}
                                            size="large"
                                            color="inherit"
                                        >
                                            <Avatar alt="avatar" src={avatar} />
                                        </IconButton>
                                    </Tooltip>
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
                                    >
                                        <MenuItem onClick={handleOpenMyPosts}>
                                            <Typography textAlign="center">
                                                My Posts
                                            </Typography>
                                        </MenuItem>
                                        <MenuItem onClick={handleOpenProfile}>
                                            <Typography textAlign="center">
                                                Edit Profile
                                            </Typography>
                                        </MenuItem>
                                        <MenuItem onClick={handleOpenFollowing}>
                                            <Typography textAlign="center">
                                                Following
                                            </Typography>
                                        </MenuItem>
                                        <MenuItem onClick={handleOpenAbout}>
                                            <Typography textAlign="center">
                                                About
                                            </Typography>
                                        </MenuItem>
                                        <MenuItem onClick={handleSwitchProfile}>
                                            <Typography textAlign="center">
                                                Switch Profile
                                            </Typography>
                                        </MenuItem>
                                    </Menu>
                                </Box>
                            </Toolbar>
                        </AppBar>
                    )}

                    {props.state && (
                        <PostModal
                            state={props.state}
                            isOpen={modalIsOpen}
                            onClose={() => {
                                setModalIsOpen(false);
                            }}
                        />
                    )}

                    <div className="app">
                        <Outlet />
                    </div>

                    {props.state && props.state.identity !== undefined && (
                        <Fab
                            color="primary"
                            size="large"
                            style={{
                                position: 'fixed',
                                right: '30px',
                                bottom: '30px',
                            }}
                            onClick={handleOpenPostModal}
                        >
                            <EditIcon />
                        </Fab>
                    )}
                </ImageViewerContext.Provider>
            </ThemeProvider>
        </div>
    );
}

export default App;
