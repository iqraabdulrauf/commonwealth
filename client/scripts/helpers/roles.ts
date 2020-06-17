import app from 'state';
import { RoleInfo, AddressInfo, Account } from 'models';

export function isAdmin() {
  const adminRole = app.login.roles?.find((role) => {
    return ((role.offchain_community_id === app.activeCommunityId()) || (role.chain_id === app.activeChainId()));
  });
  return adminRole;
}

export function isRoleOfCommunity(
  account: Account<any>,
  addresses: AddressInfo[],
  roles: RoleInfo[],
  role: string,
  community: string
) {
  if (!account || !app.isLoggedIn() || addresses.length === 0 || roles.length === 0) return false;
  const userRole = roles.find((r) => {
    const permission = (r.permission === role);
    const referencedAddress = addresses.find((address) => address.id === r.address_id);
    const isSame = account.address === referencedAddress.address;
    const ofCommunity = (r.chain_id === community) || (r.offchain_community_id === community);
    return permission && referencedAddress && isSame && ofCommunity;
  });
  return userRole;
}

export const isMember = (chain: string, community: string, address?: AddressInfo | Account<any> | undefined) => {
  if (!app.isLoggedIn()) return false;
  if (!app.login.roles) return false;

  const addressinfo: AddressInfo | undefined = (address instanceof Account)
    ? app.login.addresses.find((a) => address.address === a.address && address.chain.id === a.chain)
    : address;
  const roles = app.login.roles.filter((role) => addressinfo ? role.address_id === addressinfo.id : true);

  return chain ? roles.map((r) => r.chain_id).indexOf(chain) !== -1
    : community ? roles.map((r) => r.offchain_community_id).indexOf(community) !== -1
      : false;
};

export function isAdminOrMod(address: string) {
  if (!app.activeId()) return;
  const role = app.activeChainId()
    ? app.chain.meta.chain.adminsAndMods.find((r) => r.address === address)
    : app.community.meta.adminsAndMods.find((r) => r.address === address);
  return role;
}
