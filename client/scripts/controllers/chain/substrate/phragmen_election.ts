import _ from 'underscore';
import {
  Proposal,
  IVote,
  VotingType,
  VotingUnit,
  Account,
  ChainBase,
  ProposalStatus,
  IFixedBlockEndTime,
} from 'models';
import { ApiRx } from '@polkadot/api';
import {
  ISubstratePhragmenElection,
  ISubstratePhragmenElectionState,
  SubstrateCoin
} from 'adapters/chain/substrate/types';
import { takeWhile, first, switchMap, flatMap, map } from 'rxjs/operators';
import { combineLatest, of } from 'rxjs';
import BN from 'bn.js';
import { BalanceOf, AccountId } from '@polkadot/types/interfaces';
import { Codec } from '@polkadot/types/types';
import { Vec, StorageKey } from '@polkadot/types';
import { ProposalStore } from 'stores';
import SubstrateChain from './shared';
import SubstrateAccounts, { SubstrateAccount } from './account';
import SubstratePhragmenElections from './phragmen_elections';

// inheriting from Vote to satisfy submitVoteTx requirement,
// but choice/conviction are unused
export class PhragmenElectionVote implements IVote<SubstrateCoin> {
  public readonly account: SubstrateAccount;
  public readonly votes: string[];
  public readonly stake: SubstrateCoin;
  constructor(account: SubstrateAccount, votes: string[], stake: SubstrateCoin) {
    this.account = account;
    this.votes = votes;
    this.stake = stake;
  }
}

export class SubstratePhragmenElection extends Proposal<
  ApiRx, SubstrateCoin, ISubstratePhragmenElection, ISubstratePhragmenElectionState, PhragmenElectionVote
> {
  get shortIdentifier() {
    return `PELEC-${this.identifier.toString()}`;
  }

  private readonly _title: string;
  public get title() { return this._title; }
  public get description() { return null; }
  public get author() { return null; }

  public get support() {
    return null;
  }
  public get turnout() {
    return this._Chain.coins(this.getVotes()
      .reduce(
        (total, vote) => vote.stake.add(total),
        new BN(0)
      )).inDollars / this._Chain.totalbalance.inDollars;
  }

  public get votingType() {
    return VotingType.SimpleYesApprovalVoting;
  }
  public get votingUnit() {
    return VotingUnit.CoinVote;
  }
  public canVoteFrom(account: Account<any>) {
    return account.chainBase === ChainBase.Substrate;
  }
  get isPassing() {
    return ProposalStatus.None;
  }
  get endTime() : IFixedBlockEndTime {
    return { kind: 'fixed_block', blocknum: this.data.endBlock };
  }

  private _exposedCandidates: string[] = [];
  public get exposedCandidates() { return this._exposedCandidates; }
  public get candidates() {
    return [...this._exposedCandidates, ...this._Elections.members, ...this._Elections.runnersUp];
  }

  private _Chain: SubstrateChain;
  private _Accounts: SubstrateAccounts;
  private _Elections: SubstratePhragmenElections;
  private readonly moduleName: string;

  constructor(
    ChainInfo: SubstrateChain,
    Accounts: SubstrateAccounts,
    Elections: SubstratePhragmenElections,
    data: ISubstratePhragmenElection,
    moduleName: string,
  ) {
    super('phragmenelection', data);
    this._Chain = ChainInfo;
    this._Accounts = Accounts;
    this._Elections = Elections;
    this._title = `Election ${data.round}`;
    this.moduleName = moduleName;

    // don't use this.subscribe() bc we need to pass moduleName
    this._subscription = this._Chain.api.pipe(
      switchMap((api: ApiRx) => this._Elections.adapter.subscribeState(api, this.data))
    ).subscribe((s) => this.updateState(this._Elections.store, s));
    this.subscribeVotes();
    this._Elections.store.add(this);
  }

  // This call listens for and updates the election's voter list. We perform this logic
  // here rather than in adapters because the voters storage is done via Observable, so
  // the logic becomes simpler and more efficient, thanks to direct access to the
  // addOrUpdateVote call. If implemented in adapters, we'd need costly diffs or unneccessary
  // updates, as voters would be returned in a single array or map.
  private subscribeVotes() {
    this._Chain.api.pipe(first()).subscribe((api: ApiRx) => {
      (api.query[this.moduleName].voting
        // this branch is for kusama
        ? api.query[this.moduleName].voting.entries().pipe(
          map((voting: Array<[StorageKey, [ BalanceOf, Vec<AccountId> ] & Codec ]>) => {
            const votingData: { [voter: string]: PhragmenElectionVote } = { };
            // eslint-disable-next-line no-restricted-syntax
            for (const [ key, [ stake, votes ]] of voting) {
              const voter = key.args[0].toString();
              const vote = new PhragmenElectionVote(
                this._Accounts.get(voter),
                votes.map((v) => v.toString()),
                stake ? this._Chain.coins(stake) : this._Chain.coins(0),
              );
              votingData[voter] = vote;
            }
            return votingData;
          })
        )
        // this branch is for edgeware
        : api.query[this.moduleName].votesOf.entries().pipe(
          flatMap((votes: Array<[StorageKey, Vec<AccountId>] & Codec>) => {
            return combineLatest(
              of(votes),
              api.queryMulti(
                votes.map(([ who ]) => [ api.query[this.moduleName].stakeOf, who.args[0] ])
              ),
            );
          }),
          map(([ votes, stakes ]: [ Array<[StorageKey, Vec<AccountId>] & Codec>, BalanceOf[] ]) => {
            const votingData: { [voter: string]: PhragmenElectionVote } = {};
            // eslint-disable-next-line no-restricted-syntax
            for (const [ [ key, voterVotes ], stake ] of _.zip(votes, stakes)) {
              const voter = key.args[0].toString();
              const vote = new PhragmenElectionVote(
                this._Accounts.get(voter),
                voterVotes.map((v) => v.toString()),
                this._Chain.coins(stake)
              );
              votingData[voter] = vote;
            }
            return votingData;
          })
        ))
        .pipe(
          // automatically close on complete
          takeWhile(() => !this.completed),
        ).subscribe((votes: { [voter: string]: PhragmenElectionVote }) => {
          // first, remove all retracted voters
          // eslint-disable-next-line no-restricted-syntax
          for (const currentVoter of this.getVoters()) {
            if (!votes[currentVoter]) {
              this.removeVote(this._Accounts.get(currentVoter));
            }
          }

          // then, add or update all votes
          // eslint-disable-next-line no-restricted-syntax
          for (const vote of Object.values(votes)) {
            if (!this._Accounts.isZero(vote.account.address) && vote.stake.gtn(0)) {
              this.addOrUpdateVote(vote);
            }
          }
        });
    });
  }

  public isDefunctVoter(voter: SubstrateAccount) {
    const votes = this.getVotes(voter);
    if (!votes) throw new Error('must be a voter');
    // eslint-disable-next-line no-restricted-syntax
    for (const vote of votes[0].votes) {
      if (this.candidates.includes(vote)) {
        return false;
      }
    }
    return true;
  }

  protected updateState(store: ProposalStore<SubstratePhragmenElection>, state: ISubstratePhragmenElectionState) {
    this._exposedCandidates = state.candidates;
    super.updateState(store, state);
  }

  public submitVoteTx(vote: PhragmenElectionVote) {
    if (this.candidates.length === 0) throw new Error('cannot vote when no candidates or members');
    if (vote.votes.length === 0) throw new Error('must vote for at least one candidate');
    if (vote.votes.length > this.candidates.length) {
      throw new Error('cannot vote more than candidates');
    }
    return this._Chain.createTXModalData(
      vote.account,
      (api: ApiRx) => api.tx[this.moduleName].vote(vote.votes, vote.stake),
      'vote',
      this.title,
    );
  }
  public removeVoterTx(voter: SubstrateAccount) {
    if (!this.hasVoted(voter)) {
      throw new Error('must be a voter');
    }
    return this._Chain.createTXModalData(
      voter,
      (api: ApiRx) => api.tx[this.moduleName].removeVoter(),
      'removeVoter',
      this.title
    );
  }
  public reportDefunctVoterTx(reporter: SubstrateAccount, voter: SubstrateAccount) {
    if (reporter.address === voter.address) throw new Error('cannot report self');
    if (!this.hasVoted(reporter)) throw new Error('reporter must be a voter');
    if (!this.isDefunctVoter(voter)) throw new Error('voter not defunct');
    return this._Chain.createTXModalData(
      reporter,
      (api: ApiRx) => api.tx[this.moduleName].reportDefunctVoter(voter.address),
      'reportDefunctVoter',
      this.title
    );
  }
  public async submitCandidacyTx(candidate: SubstrateAccount) {
    if (this.candidates.includes(candidate.address)) {
      throw new Error('duplicate candidate');
    }
    const txFunc = (api: ApiRx) => api.tx[this.moduleName].submitCandidacy();
    if (!(await this._Chain.canPayFee(candidate, txFunc, this._Elections.candidacyBond))) {
      throw new Error('insufficient funds');
    }
    return this._Chain.createTXModalData(
      candidate,
      txFunc,
      'submitCandidacy',
      this.title
    );
  }
  public renounceCandidacyTx(candidate: SubstrateAccount) {
    if (!this.candidates.includes(candidate.address)) {
      throw new Error('must be candidate, member, or runner-up');
    }
    return this._Chain.createTXModalData(
      candidate,
      (api: ApiRx) => api.tx[this.moduleName].renounceCandidacy(),
      'renounceCandidacy',
      this.title
    );
  }
}