import { Request, Response, NextFunction } from 'express';
import { factory, formatFilename } from '../../shared/logging';
const log = factory.getLogger(formatFilename(__filename));

const deleteReaction = async (models, req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new Error('Not logged in'));
  }
  if (!req.body.reaction_id) {
    return next(new Error('Must provide reaction_id'));
  }

  try {
    const userOwnedAddresses = await req.user.getAddresses();
    const reaction = await models.OffchainReaction.findOne({
      where: { id: req.body.reaction_id, },
      include: [ models.Address ],
    });
    if (userOwnedAddresses.filter((addr) => addr.verified).map((addr) => addr.id).indexOf(reaction.address_id) === -1) {
      return next(new Error('Not owned by this user'));
    }
    // actually delete
    await reaction.destroy();
    return res.json({ status: 'Success' });
  } catch (e) {
    return next(e);
  }
};

export default deleteReaction;
