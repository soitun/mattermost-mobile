// Copyright (c) 2017-present Mattermost, Inc. All Rights Reserved.
// See License.txt for license information.

import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {
    Alert,
    InteractionManager,
    StyleSheet,
    View
} from 'react-native';
import {injectIntl, intlShape} from 'react-intl';

import Loading from 'app/components/loading';
import MemberList from 'app/components/custom_list';
import SearchBar from 'app/components/search_bar';
import StatusBar from 'app/components/status_bar';
import {createMembersSections, loadingText, markSelectedProfiles} from 'app/utils/member_list';
import MemberListRow from 'app/components/custom_list/member_list_row';
import {changeOpacity, makeStyleSheetFromTheme} from 'app/utils/theme';

import {General, RequestStatus} from 'mattermost-redux/constants';
import {displayUsername, filterProfilesMatchingTerm} from 'mattermost-redux/utils/user_utils';

class ChannelMembers extends PureComponent {
    static propTypes = {
        intl: intlShape.isRequired,
        theme: PropTypes.object.isRequired,
        currentChannel: PropTypes.object,
        currentChannelMembers: PropTypes.array.isRequired,
        currentUserId: PropTypes.string.isRequired,
        navigator: PropTypes.object,
        teammateNameDisplay: PropTypes.string,
        requestStatus: PropTypes.string,
        searchRequestStatus: PropTypes.string,
        removeMembersStatus: PropTypes.string,
        canManageUsers: PropTypes.bool.isRequired,
        actions: PropTypes.shape({
            getProfilesInChannel: PropTypes.func.isRequired,
            handleRemoveChannelMembers: PropTypes.func.isRequired,
            searchProfiles: PropTypes.func.isRequired
        })
    };

    removeButton = {
        disabled: true,
        id: 'remove-members',
        showAsAction: 'always'
    };

    constructor(props) {
        super(props);

        this.searchTimeoutId = 0;

        this.state = {
            canSelect: true,
            next: true,
            page: 0,
            profiles: [],
            searching: false,
            selectedMembers: {},
            showNoResults: false,
            term: ''
        };
        this.removeButton.title = props.intl.formatMessage({id: 'channel_members_modal.remove', defaultMessage: 'Remove'});

        props.navigator.setOnNavigatorEvent(this.onNavigatorEvent);
        if (props.canManageUsers) {
            props.navigator.setButtons({
                rightButtons: [this.removeButton]
            });
        }
    }

    componentDidMount() {
        InteractionManager.runAfterInteractions(() => {
            this.props.actions.getProfilesInChannel(this.props.currentChannel.id, 0);
        });

        this.emitCanRemoveMembers(false);
    }

    componentWillReceiveProps(nextProps) {
        const {requestStatus} = this.props;
        if (requestStatus === RequestStatus.STARTED &&
            nextProps.requestStatus === RequestStatus.SUCCESS) {
            const {page} = this.state;
            const profiles = markSelectedProfiles(
                nextProps.currentChannelMembers.splice(0, (page + 1) * General.PROFILE_CHUNK_SIZE),
                this.state.selectedMembers
            );
            this.setState({profiles, showNoResults: true});
        } else if (this.state.searching &&
            nextProps.searchRequestStatus === RequestStatus.SUCCESS) {
            const results = markSelectedProfiles(
                filterProfilesMatchingTerm(nextProps.currentChannelMembers, this.state.term),
                this.state.selectedMembers
            );
            this.setState({profiles: results, showNoResults: true});
        }

        const {removeMembersStatus} = nextProps;

        if (this.props.removeMembersStatus !== removeMembersStatus) {
            switch (removeMembersStatus) {
            case RequestStatus.STARTED:
                this.emitRemoving(true);
                this.setState({error: null, canSelect: false, removing: true});
                break;
            case RequestStatus.SUCCESS:
                this.emitRemoving(false);
                this.setState({error: null, canSelect: false, removing: false});
                this.close();
                break;
            case RequestStatus.FAILURE:
                this.emitRemoving(false);
                this.setState({canSelect: true, removing: false});
                break;
            }
        }
    }

    cancelSearch = () => {
        this.setState({
            searching: false,
            term: '',
            page: 0,
            profiles: markSelectedProfiles(this.props.currentChannelMembers, this.state.selectedMembers)
        });
    };

    close = () => {
        this.props.navigator.pop({animated: true});
    };

    emitCanRemoveMembers = (enabled) => {
        if (this.props.canManageUsers) {
            this.props.navigator.setButtons({
                rightButtons: [{...this.removeButton, disabled: !enabled}]
            });
        }
    };

    emitRemoving = (loading) => {
        this.setState({canSelect: false, removing: loading});

        if (this.props.canManageUsers) {
            this.props.navigator.setButtons({
                rightButtons: [{...this.removeButton, disabled: loading}]
            });
        }
    };

    handleRemoveMembersPress = () => {
        const {selectedMembers} = this.state;
        const membersToRemove = Object.keys(selectedMembers).filter((m) => selectedMembers[m]);

        const {formatMessage} = this.props.intl;
        if (!membersToRemove.length) {
            Alert.alert(
                formatMessage({
                    id: 'mobile.routes.channel_members.action',
                    defaultMessage: 'Remove Members'
                }),
                formatMessage({
                    id: 'mobile.routes.channel_members.action_message',
                    defaultMessage: 'You must select at least one member to remove from the channel.'
                })
            );
            return;
        }

        Alert.alert(
            formatMessage({
                id: 'mobile.routes.channel_members.action',
                defaultMessage: 'Remove Members'
            }),
            formatMessage({
                id: 'mobile.routes.channel_members.action_message_confirm',
                defaultMessage: 'Are you sure you want to remove the selected members from the channel?'
            }),
            [{
                text: formatMessage({id: 'mobile.channel_list.alertNo', defaultMessage: 'No'})
            }, {
                text: formatMessage({id: 'mobile.channel_list.alertYes', defaultMessage: 'Yes'}),
                onPress: () => this.removeMembers(membersToRemove)
            }]
        );
    };

    handleRowSelect = (id) => {
        const selectedMembers = Object.assign({}, this.state.selectedMembers, {[id]: !this.state.selectedMembers[id]});
        if (Object.values(selectedMembers).filter((selected) => selected).length) {
            this.emitCanRemoveMembers(true);
        } else {
            this.emitCanRemoveMembers(false);
        }
        this.setState({
            profiles: markSelectedProfiles(this.state.profiles, selectedMembers),
            selectedMembers
        });
    };

    loadMoreMembers = () => {
        const {actions, requestStatus, currentChannel} = this.props;
        const {next, searching} = this.state;
        let {page} = this.state;
        if (requestStatus !== RequestStatus.STARTED && next && !searching) {
            page = page + 1;
            actions.getProfilesInChannel(currentChannel.id, page, General.PROFILE_CHUNK_SIZE).then(
                (data) => {
                    if (data && data.length) {
                        this.setState({
                            page
                        });
                    } else {
                        this.setState({next: false});
                    }
                }
            );
        }
    };

    onNavigatorEvent = (event) => {
        if (event.type === 'NavBarButtonPress') {
            if (event.id === 'remove-members') {
                this.handleRemoveMembersPress();
            }
        }
    };

    removeMembers = (membersToRemove) => {
        const {actions, currentChannel} = this.props;
        actions.handleRemoveChannelMembers(currentChannel.id, membersToRemove);
    };

    renderMemberRow = (user, sectionId, rowId, teammateNameDisplay, theme, selectable, onPress, onSelect) => {
        const {id, username} = user;
        const displayName = displayUsername(user, teammateNameDisplay);
        let onRowSelect = null;
        if (selectable) {
            onRowSelect = () => onSelect(sectionId, rowId);
        }

        const disableSelect = user.id === this.props.currentUserId;

        return (
            <MemberListRow
                id={id}
                user={user}
                displayName={displayName}
                username={username}
                theme={theme}
                onPress={onPress}
                selectable={selectable}
                selected={user.selected}
                onRowSelect={onRowSelect}
                disableSelect={disableSelect}
            />
        );
    };

    searchProfiles = (text) => {
        const term = text.toLowerCase();

        if (term) {
            this.setState({searching: true, term});
            clearTimeout(this.searchTimeoutId);

            this.searchTimeoutId = setTimeout(() => {
                this.props.actions.searchProfiles(term, {in_channel_id: this.props.currentChannel.id});
            }, General.SEARCH_TIMEOUT_MILLISECONDS);
        } else {
            this.cancelSearch();
        }
    };

    render() {
        const {canManageUsers, intl, teammateNameDisplay, requestStatus, searchRequestStatus, theme} = this.props;
        const {formatMessage} = intl;
        const {profiles, removing, searching, showNoResults, term} = this.state;
        const isLoading = (requestStatus === RequestStatus.STARTED) || (requestStatus.status === RequestStatus.NOT_STARTED) ||
            (searchRequestStatus === RequestStatus.STARTED);
        const more = searching ? () => true : this.loadMoreMembers;
        const style = getStyleFromTheme(theme);

        if (removing) {
            return (
                <View style={style.container}>
                    <StatusBar/>
                    <Loading/>
                </View>
            );
        }

        return (
            <View style={style.container}>
                <StatusBar/>
                <View
                    style={{marginVertical: 5}}
                >
                    <SearchBar
                        ref='search_bar'
                        placeholder={formatMessage({id: 'search_bar.search', defaultMessage: 'Search'})}
                        cancelTitle={formatMessage({id: 'mobile.post.cancel', defaultMessage: 'Cancel'})}
                        backgroundColor='transparent'
                        inputHeight={33}
                        inputStyle={{
                            backgroundColor: changeOpacity(theme.centerChannelColor, 0.2),
                            color: theme.centerChannelColor,
                            fontSize: 13
                        }}
                        placeholderTextColor={changeOpacity(theme.centerChannelColor, 0.5)}
                        tintColorSearch={changeOpacity(theme.centerChannelColor, 0.8)}
                        tintColorDelete={changeOpacity(theme.centerChannelColor, 0.5)}
                        titleCancelColor={theme.centerChannelColor}
                        onChangeText={this.searchProfiles}
                        onSearchButtonPress={this.searchProfiles}
                        onCancelButtonPress={this.cancelSearch}
                        value={term}
                    />
                </View>
                <MemberList
                    data={profiles}
                    theme={theme}
                    searching={searching}
                    onListEndReached={more}
                    teammateNameDisplay={teammateNameDisplay}
                    listScrollRenderAheadDistance={50}
                    loading={isLoading}
                    loadingText={loadingText}
                    selectable={canManageUsers && this.state.canSelect}
                    onRowSelect={this.handleRowSelect}
                    renderRow={this.renderMemberRow}
                    createSections={createMembersSections}
                    showNoResults={showNoResults}
                />
            </View>
        );
    }
}

const getStyleFromTheme = makeStyleSheetFromTheme((theme) => {
    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.centerChannelBg
        }
    });
});

export default injectIntl(ChannelMembers);
