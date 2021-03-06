
import crypto from 'crypto';
import { factory, formatFilename } from '../../shared/logging';
const log = factory.getLogger(formatFilename(__filename));

const createInviteLink = async (models, req, res, next) => {
  if (!req.user) return next(new Error('Not logged in'));
  const { community_id, time } = req.body;
  if (!community_id) return next(new Error('Error finding community'));
  if (!time) return next(new Error('Must provide a time limit'));

  const community = await models.OffchainCommunity.findOne({
    where: {
      id: community_id,
    },
  });
  if (!community) return next(new Error('Invalid community'));

  if (!community.invitesEnabled) {
    const requesterIsAdminOrMod = await models.Role.findAll({
      where: {
        address_id: req.user.address_id, // this is overriding the search, bc null
        offchain_community_id: community.id,
        permission: ['admin', 'moderator'],
      },
    });
    if (!requesterIsAdminOrMod) return next(new Error('Must be an admin/mod to create Invite Link'));
  }

  let { uses } = req.body;
  if (uses === 'none') {
    uses = null;
  } else {
    uses = +uses;
  }
  if (isNaN(uses)) {
    return next(new Error('Must provide a valid number of uses'));
  }

  // check to see if unlimited time + unlimited usage already exists
  if (uses === null && time === 'none') {
    const foreverInvite = await models.InviteLink.findOne({
      where: {
        community_id: community.id,
        creator_id: req.user.id,
        multi_use: uses, // null
        time_limit: time, // 'none'
      },
    });
    if (foreverInvite) {
      if (foreverInvite.active === false) {
        await foreverInvite.update({ active: true, });
      }
      return res.json({ status: 'Success', result: foreverInvite.toJSON() });
    }
  }

  const inviteId = crypto.randomBytes(24).toString('hex');

  const inviteLink = await models.InviteLink.create({
    id: inviteId,
    community_id: community.id,
    creator_id: req.user.id,
    active: true,
    multi_use: uses,
    time_limit: time,
    used: 0,
  });
  if (!inviteLink) { return res.json({ status: 'Failure' }); }

  return res.json({ status: 'Success', result: inviteLink.toJSON() });
};

export default createInviteLink;
