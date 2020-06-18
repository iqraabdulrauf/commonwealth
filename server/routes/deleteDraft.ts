import { Request, Response, NextFunction } from 'express';
import lookupAddressIsOwnedByUser from '../util/lookupAddressIsOwnedByUser';
import lookupCommunityIsVisibleToUser from '../util/lookupCommunityIsVisibleToUser';
import { factory, formatFilename } from '../../shared/logging';

const log = factory.getLogger(formatFilename(__filename));

export const Errors = {
  NoId: 'Must provide id',
  NotOwner: 'User does not have permission to edit this thread.',
  NotFound: 'No draft found for that user'
};

const deleteDraft = async (models, req: Request, res: Response, next: NextFunction) => {
  const [chain, community] = await lookupCommunityIsVisibleToUser(models, req.body, req.user, next);
  const author = await lookupAddressIsOwnedByUser(models, req, next);
  if (!req.body.id) {
    return next(new Error(Errors.NoId));
  }

  try {
    const userOwnedAddresses = await req.user.getAddresses();
    const draft = await models.DiscussionDraft.findOne({
      where: {
        id: req.body.id,
      },
    });
    if (!draft) {
      return next(new Error(Errors.NotFound));
    }
    if (userOwnedAddresses.filter((addr) => addr.verified).map((addr) => addr.id).indexOf(draft.author_id) === -1) {
      return next(new Error(Errors.NotOwner));
    }
    await draft.destroy();
    return res.json({ status: 'Success' });
  } catch (e) {
    return next(e);
  }
};

export default deleteDraft;