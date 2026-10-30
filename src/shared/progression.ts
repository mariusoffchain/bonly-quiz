import type { SessionState } from './types.js';

/** Same next action is displayed by the console and executed by the server. */
export function nextStep(state: SessionState) {
  if (state.phase === 'finished') return undefined;
  const round = state.roundStates[state.currentRoundIndex];
  const pending = state.roundStates.findIndex((r) => r.status === 'pending');
  const key = [state.code, state.currentRoundIndex, state.phase, round?.currentQuestion ?? -1,
    round?.questionRuns[round.currentQuestion]?.openedAt ?? '', round?.startedAt ?? ''].join(':');
  if (!round || round.status !== 'running') {
    if (pending < 0) return undefined;
    return { key, action: 'start-round' as const, index: pending,
      label: state.phase === 'lobby' ? 'Commencer la partie · manche 1' : `Commencer la manche ${pending + 1} · hashrate conservé` };
  }
  if (state.phase === 'question-open') return { key, action: 'close-question' as const, label: 'Afficher la réponse' };
  const total = state.rounds[state.currentRoundIndex].questionIds.length;
  if (round.currentQuestion + 1 < total) return { key, action: 'open-question' as const,
    label: `Afficher la question ${round.currentQuestion + 2} / ${total}` };
  return { key, action: 'end-round' as const,
    label: pending < 0 ? 'Afficher le bilan final de la partie' : `Afficher le bilan de la manche ${state.currentRoundIndex + 1}` };
}
