import { Fragment } from 'react';
import { GitFork, MessageCircle, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { agentIcon } from '../lib/status';
import { secs, type NodeState, type RunView, type StepView } from '../lib/trail';

const W = 1040, NH = 54, GAP = 90, TOP = 40;

function Node({ icon: I, title, sub, state, x, y, w = 180, onClick }: {
  icon: LucideIcon; title: string; sub: string; state: NodeState; x?: number; y?: number; w?: number; onClick?: () => void;
}) {
  const dot = state === 'done' ? 'done' : state === 'active' ? 'active' : state === 'error' ? 'error' : null;
  const cls = `ns-node${state === 'active' ? ' active' : ''}${state === 'idle' || state === 'waiting' ? ' idle' : ''}${onClick ? ' clickable' : ''}`;
  const style = x === undefined ? undefined : { left: x, top: y, width: w };
  const inner = (
    <>
      <span className="ic"><I aria-hidden="true" /></span>
      <div style={{ minWidth: 0 }}><div className="t">{title}</div><div className="s">{sub}</div></div>
      {dot && <span className={`dot ${dot}`} aria-label={dot} />}
    </>
  );
  return onClick
    ? <button type="button" className={cls} style={{ ...style, font: 'inherit', color: 'inherit', textAlign: 'left' }} onClick={onClick}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}

/**
 * Citizen -> Concierge -> Orchestrator -> department agents, with thin edges, a dashed blue
 * edge for the request in flight, and the five-step run along the bottom. On phones it turns
 * into a vertical chain with a vertical timeline.
 */
export function WorkflowGraph({ run, citizenSub, conciergeSub, onNode, label }: {
  run: RunView; citizenSub: string; conciergeSub: string; onNode?: (key: string) => void; label?: string;
}) {
  const n = Math.max(run.depts.length, 1);
  const midTop = TOP + ((n - 1) * GAP) / 2;
  const cy = midTop + NH / 2;
  const H = Math.max(340, TOP + n * GAP - (GAP - NH) + 160);
  const edgeCls = (e: 'done' | 'live' | 'idle' | 'fail') => `e${e === 'done' ? '' : ' ' + e}`;
  return (
    <div className="graph-box">
      <div className="canvas-wrap">
        <div className="graph" style={{ width: W, height: H }} role="img" aria-label={label ?? 'Agent workflow'}>
          <div className="dots" />
          <svg className="edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <path className={edgeCls(run.liveEdge === 'concierge' ? 'live' : 'done')} d={`M212 ${cy} L272 ${cy}`} />
            <path className={edgeCls(run.liveEdge === 'orchestrator' ? 'live' : run.orchestrator === 'waiting' ? 'idle' : 'done')} d={`M452 ${cy} L512 ${cy}`} />
            {run.depts.map((d, i) => {
              const y = TOP + i * GAP + NH / 2;
              return <path key={d.key} className={edgeCls(d.edge)} d={`M692 ${cy} C 745 ${cy} 740 ${y} 790 ${y}`} />;
            })}
          </svg>
          <Node icon={User} title="Citizen" sub={citizenSub} state="done" x={32} y={midTop} />
          <Node icon={MessageCircle} title="Concierge" sub={conciergeSub} state={run.concierge} x={272} y={midTop} onClick={onNode && (() => onNode('concierge'))} />
          <Node icon={GitFork} title="Orchestrator" sub={run.orchSub} state={run.orchestrator} x={512} y={midTop} onClick={onNode && (() => onNode('orchestrator'))} />
          {run.depts.map((d, i) => (
            <Node key={d.key} icon={agentIcon(d.key)} title={d.name} sub={d.sub} state={d.state} x={790} y={TOP + i * GAP} w={210} onClick={onNode && (() => onNode(d.key))} />
          ))}
          {!run.depts.length && <div className="ns-node idle" style={{ position: 'absolute', left: 790, top: midTop, width: 210 }}><div><div className="t">No department</div><div className="s">not routed</div></div></div>}
          <span className="lbl" style={{ left: 242, top: midTop - 26 }}>chat</span>
          <span className={`lbl${run.liveEdge === 'orchestrator' ? ' live' : ''}`} style={{ left: 482, top: midTop - 26 }}>message/send</span>
          {run.depts.map((d, i) => d.edge === 'live'
            ? <span key={d.key} className="lbl live" style={{ left: 742, top: (cy + TOP + i * GAP + NH / 2) / 2 - 9 }}>tasks/get</span>
            : null)}
          <div className="htl">
            {run.steps.map(s => <div key={s.key} className={`s ${s.state}`}><i /><b>{s.label}</b><span>{s.at === undefined ? '—' : '+' + secs(s.at)}</span></div>)}
          </div>
        </div>
      </div>
      <div className="chain">
        <Node icon={User} title="Citizen" sub={citizenSub} state="done" />
        <div className="conn"><span>chat</span></div>
        <Node icon={MessageCircle} title="Concierge" sub={conciergeSub} state={run.concierge} />
        <div className={`conn${run.liveEdge === 'orchestrator' ? ' live' : ''}`}><span>message/send</span></div>
        <Node icon={GitFork} title="Orchestrator" sub={run.orchSub} state={run.orchestrator} />
        <div className={`conn${run.depts.some(d => d.edge === 'live') ? ' live' : ''}`}><span>{run.depts.some(d => d.edge === 'live') ? 'tasks/get' : 'A2A'}</span></div>
        <div className="fan">{run.depts.map(d => <Node key={d.key} icon={agentIcon(d.key)} title={d.name} sub={d.sub} state={d.state} />)}</div>
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--separator)' }}><Timeline steps={run.steps} /></div>
      </div>
    </div>
  );
}

/** Vertical execution timeline. */
export function Timeline({ steps, onStep }: { steps: StepView[]; onStep?: (s: StepView) => void }) {
  return (
    <ol className="ns-tl">
      {steps.map(s => {
        const cls = s.state === 'now' ? 'now' : s.state === 'fail' ? 'fail' : s.state === 'pending' ? 'pending' : 'done';
        const body = (
          <Fragment>
            <span className="k" />
            <div><div className="h">{s.long}</div>{s.detail && <div className="b">{s.detail}</div>}</div>
            <span className="ms">{s.at === undefined ? '—' : secs(s.at)}</span>
          </Fragment>
        );
        return <li key={s.key} className={cls} onClick={onStep && (() => onStep(s))} style={onStep ? { cursor: 'pointer' } : undefined}>{body}</li>;
      })}
    </ol>
  );
}
