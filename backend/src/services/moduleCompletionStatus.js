// Single definition of "done" for a piece of trackable learning content, shared
// by the Daily Batch Report engine and the Module Completion Detail Report so
// the two never disagree about whether a trainee has actually finished
// something. Previously the daily report judged curriculum content by
// time-based completion alone (ignoring acknowledgement) and independent
// "nugget" modules by acknowledgement alone (ignoring time-based completion) --
// this reconciles both under one rule: content counts as done only once it is
// both time-complete AND acknowledged against its current version.
//
// Statuses:
//   Not Started              - never opened
//   In Progress               - opened, has not reached the completion threshold
//   Content Completed         - reached the completion threshold, not yet acknowledged
//   Re-acknowledgement Required - was acknowledged, but the content's version has
//                                 moved on since (see content_master.contentVersion /
//                                 content_repository_master.version_no)
//   Completed                 - time-complete and acknowledged against the current version
export function computeContentStatus(progress, currentVersion = 1) {
  if (!progress || !progress.opened) return 'Not Started';

  const timeComplete = progress.completionStatus === 'Completed' || Number(progress.completionPct || 0) >= 100;
  if (!timeComplete) return 'In Progress';

  if (!progress.acknowledgedAt) return 'Content Completed';

  const ackVersion = Number(progress.acknowledgedVersion ?? 1);
  if (ackVersion < Number(currentVersion || 1)) return 'Re-acknowledgement Required';

  return 'Completed';
}

export function isFullyDone(status) {
  return status === 'Completed';
}

export function isAcknowledgementPending(status) {
  return status === 'Content Completed' || status === 'Re-acknowledgement Required';
}
