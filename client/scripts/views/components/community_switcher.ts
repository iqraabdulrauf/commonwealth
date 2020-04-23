import 'components/community_switcher.scss';

import m from 'mithril';
import $ from 'jquery';
import mixpanel from 'mixpanel-browser';
import { Icon, Icons, PopoverMenu, MenuItem, Button, Tooltip } from 'construct-ui';

import app from 'state';
import { initAppState } from 'app';
import { link } from 'helpers';

import { AddressInfo, CommunityInfo, NodeInfo } from 'models';
import { isMember } from 'views/components/membership_button';
import User from 'views/components/widgets/user';
import { notifySuccess } from 'controllers/app/notifications';
import ChainIcon from 'views/components/chain_icon';
import FeedbackModal from 'views/modals/feedback_modal';

const avatarSize = 14;

const CommunitySwitcherChain: m.Component<{ chain: string, nodeList: NodeInfo[], address: AddressInfo }> = {
  view: (vnode) => {
    const { chain, nodeList, address } = vnode.attrs;

    const active = app.activeChainId() === chain && (!address || (address.chain === app.vm.activeAccount?.chain.id &&
                                                                  address.address === app.vm.activeAccount?.address));

    return m('a.CommunitySwitcherChain', {
      href: '#',
      class: active ? 'active' : '',
      onclick: (e) => {
        e.preventDefault();
        if (address) {
          localStorage.setItem('initAddress', address.address);
          localStorage.setItem('initChain', address.chain);
        }
        m.route.set(`/${chain}/`);
      }
    }, [
      m('.icon-inner', [
        m(ChainIcon, { chain: nodeList[0].chain }),
        m(User, { user: [address.address, address.chain], avatarOnly: true, avatarSize: 16 }),
      ]),
      m('.content-inner', [
        m('.sidebar-name', nodeList[0].chain.name),
        m('.sidebar-user', [ 'Joined as ', m(User, { user: [address.address, address.chain], avatarSize: avatarSize, hideAvatar: true }) ]),
      ]),
    ]);
  }
};

const CommunitySwitcherCommunity: m.Component<{ community: CommunityInfo, address: AddressInfo }> = {
  view: (vnode) => {
    const { community, address } = vnode.attrs;

    const active = app.activeCommunityId() === community.id && (!address || (address.chain === app.vm.activeAccount?.chain.id &&
                                                                             address.address === app.vm.activeAccount?.address));
    return m('a.CommunitySwitcherCommunity', {
      href: '#',
      class: active ? 'active' : '',
      onclick: (e) => {
        e.preventDefault();
        if (address) {
          localStorage.setItem('initAddress', address.address);
          localStorage.setItem('initChain', address.chain);
        }
        m.route.set(`/${community.id}/`);
      },
    }, [
      m('.icon-inner', [
        m('.name', community.name.slice(0, 2).toLowerCase()),
        m(User, { user: [address.address, address.chain], avatarOnly: true, avatarSize: 16 }),
      ]),
      m('.content-inner', [
        m('.sidebar-name', community.name),
        m('.sidebar-user', [ 'Joined as ', m(User, { user: [address.address, address.chain], avatarSize: avatarSize, hideAvatar: true }) ]),
      ]),
    ]);
  }
};

const CommunitySwitcherSettingsMenu: m.Component<{}> = {
  view: (vnode) => {

    return m(PopoverMenu, {
      transitionDuration: 50,
      hoverCloseDelay: 0,
      trigger: m(Button, {
        iconLeft: Icons.SETTINGS,
        size: 'default',
        class: 'CommunitySwitcherSettingsMenu',
      }),
      position: 'right-end',
      closeOnContentClick: true,
      menuAttrs: {
        align: 'left',
      },
      content: [
        // settings
        m(MenuItem, {
          onclick: () => {
            m.route.set('/');
          },
          contentLeft: m(Icon, { name: Icons.HOME }),
          label: 'Home'
        }),
        // settings
        m(MenuItem, {
          onclick: () => {
            m.route.set('/settings');
          },
          contentLeft: m(Icon, { name: Icons.SETTINGS }),
          label: 'Settings'
        }),
        // admin
        app.login?.isSiteAdmin && app.activeChainId() && m(MenuItem, {
          onclick: () => {
            m.route.set(`/${app.activeChainId()}/admin`);
          },
          contentLeft: m(Icon, { name: Icons.USER }),
          label: 'Admin'
        }),
        //
        m(MenuItem, {
          label: 'Privacy',
          onclick: () => { m.route.set('/privacy'); }
        }),
        m(MenuItem, {
          label: 'Terms',
          onclick: () => { m.route.set('/terms'); }
        }),
        m(MenuItem, {
          label: 'Send feedback',
          onclick: () => {
            app.modals.create({ modal: FeedbackModal });
          }
        }),
        // logout
        app.isLoggedIn() && m(MenuItem, {
          onclick: () => {
            $.get(app.serverUrl() + '/logout').then(async () => {
              await initAppState();
              notifySuccess('Logged out');
              m.route.set('/');
              m.redraw();
            }).catch((err) => {
              location.reload();
            });
            mixpanel.reset();
          },
          contentLeft: m(Icon, { name: Icons.X_SQUARE }),
          label: 'Logout'
        }),
      ]
    });
  }
};

const CommunitySwitcher: m.Component<{}> = {
  view: (vnode) => {
    if (!app.isLoggedIn()) return;

    const chains = {};
    app.config.nodes.getAll().forEach((n) => {
      chains[n.chain.id] ? chains[n.chain.id].push(n) : chains[n.chain.id] = [n];
    });

    return m('.CommunitySwitcher', [
      m('.sidebar-content', [
        app.login.roles.map((role) => {
          const address = app.login.addresses.find((address) => address.id === role.address_id);
          if (role.offchain_community_id) {
            const community = app.config.communities.getAll().find((community) => community.id === role.offchain_community_id);
            return m(CommunitySwitcherCommunity, { community, address });
          } else {
            return m(CommunitySwitcherChain, { chain: role.chain_id, nodeList: chains[role.chain_id], address });
          }
        }),
      ]),
      m(CommunitySwitcherSettingsMenu),
    ]);
  }
};

export default CommunitySwitcher;