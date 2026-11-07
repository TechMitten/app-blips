import { useEffect, useState } from 'react';
import { fetchBillingConfig, fetchBillingMe, openCheckout } from '../lib/billing';
import {
  clearSandboxTerminalLog,
  execInSandboxComputer,
  fetchSandboxStatus,
  getSandboxTerminalLog,
  snapshotSandboxComputer,
  subscribeSandboxTerminal,
} from '../lib/sandboxComputer';
import { SignInButton } from '@clerk/react';
import { useAccounts } from '../lib/accounts';
import { SettingRow, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';

const price = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
// " (up to 50 every 5 hours)" for a plan with a build cooldown (plans.js).
const windowText = (plan) => (plan?.windowBuilds && plan?.windowHours
  ? ` (up to ${plan.windowBuilds} every ${plan.windowHours} hours)` : '');

function SandboxComputerSection({ sandboxId: initialSandboxId, snapshotId: initialSnapshotId }) {
  const [sandboxId, setSandboxId] = useState(initialSandboxId || null);
  const [snapshotId, setSnapshotId] = useState(initialSnapshotId || null);
  const [entries, setEntries] = useState(() => getSandboxTerminalLog());
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => subscribeSandboxTerminal(setEntries), []);

  const runManualCommand = async (event) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setNotice('');
    setCommand('');
    try {
      const res = await execInSandboxComputer({ command: trimmed, syncBack: false });
      if (res?.sandboxId) setSandboxId(res.sandboxId);
    } catch (err) {
      setNotice(err.message || 'Command failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleSnapshot = async () => {
    if (snapshotting) return;
    setSnapshotting(true);
    setNotice('');
    try {
      const snap = await snapshotSandboxComputer();
      if (snap?.sandboxId) setSandboxId(snap.sandboxId);
      if (snap?.snapshotId) setSnapshotId(snap.snapshotId);
      setNotice(`Saved filesystem snapshot (${snap.snapshotId}).`);
    } catch (err) {
      setNotice(err.message || 'Could not save snapshot.');
    } finally {
      setSnapshotting(false);
    }
  };

  return (
    <>
      <SettingRow
        id="set-sandbox-computer"
        title="Agent computer"
        description={sandboxId
          ? `Dedicated Linux sandbox (${sandboxId})${snapshotId ? ` · latest snapshot ${snapshotId}` : ''} — auto-sleeps after 5 minutes of inactivity.`
          : 'Dedicated Linux sandbox — provisions automatically on your next build and auto-sleeps when idle.'}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {sandboxId ? 'Provisioned' : 'Ready'}
          </span>
          {sandboxId && (
            <button
              type="button"
              onClick={handleSnapshot}
              disabled={snapshotting}
              className={SECONDARY_BUTTON}
            >
              {snapshotting ? 'Saving…' : 'Save snapshot'}
            </button>
          )}
        </div>
      </SettingRow>

      <div className="px-4 pb-4">
        <form onSubmit={runManualCommand} className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Run a command in /workspace (e.g. node -v or ls -la)…"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={running || !command.trim()}
            className={SECONDARY_BUTTON}
          >
            {running ? 'Running…' : 'Run'}
          </button>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={clearSandboxTerminalLog}
              className={SECONDARY_BUTTON}
            >
              Clear
            </button>
          )}
        </form>

        {notice && <p className="mt-2 text-xs text-slate-600">{notice}</p>}

        {entries.length > 0 && (
          <div
            className="mt-3 max-h-56 overflow-y-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-200"
            aria-label="Agent computer terminal output"
          >
            {entries.map((entry) => (
              <div key={entry.id} className="mb-2.5 last:mb-0">
                <div className="flex items-center justify-between text-indigo-300">
                  <span>$ {entry.command}</span>
                  <span className="text-[10px] text-slate-400">
                    {entry.running ? 'running…' : `exit ${entry.exitCode ?? 0}`}
                  </span>
                </div>
                {entry.stdout && <pre className="mt-1 whitespace-pre-wrap break-words text-slate-200">{entry.stdout}</pre>}
                {entry.stderr && <pre className="mt-1 whitespace-pre-wrap break-words text-amber-300">{entry.stderr}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Plan and credit status for hosted AppBlips, plus the user's Render Sandbox
// agent computer controls.
export default function PlanSettings() {
  const accounts = useAccounts();
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [sandboxStatus, setSandboxStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [nextConfig, nextSandbox] = await Promise.all([
        fetchBillingConfig(),
        fetchSandboxStatus(),
      ]);
      if (cancelled) return;
      setConfig(nextConfig);
      setSandboxStatus(nextSandbox);
      if (nextConfig.hosted) {
        const nextMe = await fetchBillingMe();
        if (!cancelled) setMe(nextMe);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="p-4 text-sm text-slate-500">Loading plan…</p>;
  // The agent computer is a paid-plan feature (the server refuses it
  // elsewhere), so a copy without accounts has nothing to show here.
  if (!config?.hosted) {
    return (
      <p className="p-4 text-sm leading-relaxed text-slate-500">
        Plans and credits are available on AppBlips Cloud. This install uses your own AI provider,
        so there is nothing to bill.
      </p>
    );
  }
  // Signed out: an own-key user. Signing in is how they move to a plan.
  if (!me && accounts) {
    return (
      <SettingRow
        id="set-plan-signin"
        title="AppBlips plans"
        description="You’re using your own AI key. Sign in to subscribe to a plan: AppBlips runs the AI, so there’s no API key to set up."
      >
        <SignInButton mode="modal">
          <button type="button" className={PRIMARY_BUTTON}>Sign in</button>
        </SignInButton>
      </SettingRow>
    );
  }

  const active = Boolean(me?.active);
  const currentId = active ? me?.plan : null;
  const currentPrice = active
    ? (config.plans || []).find((plan) => plan.id === currentId)?.priceCents ?? 0
    : -1;
  const currentName = active ? me.planName : 'No active plan';
  const currentPlan = (config.plans || []).find((plan) => plan.id === currentId);
  const credits = !active
    ? 'Subscribe to start building'
    : me.unlimited
      ? `unlimited builds while AppBlips is in beta${windowText(currentPlan)}`
      : me.credits == null
        ? '—'
        : `${me.credits} of ${me.monthlyCredits} left this month`;

  const upgrade = async (planId) => {
    setBusy(planId);
    setError('');
    try {
      await openCheckout(planId);
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
      setBusy(null);
    }
  };

  return (
    <>
      <SettingRow
        id="set-plan"
        title="Current plan"
        description={me ? `${currentName} — ${credits}` : 'Could not load your plan.'}
      >
        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          {currentName}
        </span>
      </SettingRow>

      {active && sandboxStatus?.configured && (
        <SandboxComputerSection
          sandboxId={me?.sandboxId || sandboxStatus?.sandboxId}
          snapshotId={me?.sandboxSnapshotId || sandboxStatus?.snapshotId}
        />
      )}

      {/* The current plan or one on offer has beta terms: say so plainly, once,
          before anyone pays (plans.js betaPricing). */}
      {(config.plans || []).some((plan) => plan.betaPricing && !plan.comingSoon) && (
        <p className="mx-4 mb-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-800">Beta pricing.</span>{' '}
          {(config.plans || []).filter((plan) => plan.betaPricing && !plan.comingSoon).map((plan) => (
            `${plan.name}’s ${price(plan.priceCents)}/month price${plan.monthlyCredits == null ? ' and unlimited builds' : ''}`
          )).join(', ')} last only while AppBlips is in beta. The price and build limits will change when the beta ends.
        </p>
      )}

      {(config.plans || []).filter((plan) => plan.id !== currentId).map((plan) => {
        const details = plan.monthlyCredits == null
          ? `unlimited builds${plan.betaPricing ? ' while AppBlips is in beta' : ''}${windowText(plan)}`
          : `${plan.monthlyCredits} build credits monthly`;
        const action = !active ? 'Subscribe' : plan.priceCents > currentPrice ? 'Upgrade' : 'Switch';
        return (
          <SettingRow
            key={plan.id}
            id={`set-plan-${plan.id}`}
            title={plan.name}
            description={`${price(plan.priceCents)} per month${plan.betaPricing ? ' (beta price)' : ''} — ${details}.`}
          >
            {plan.comingSoon ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Coming soon
              </span>
            ) : (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy !== null}
                onClick={() => upgrade(plan.id)}
              >
                {busy === plan.id ? 'Opening checkout…' : `${action} to ${plan.name}`}
              </button>
            )}
          </SettingRow>
        );
      })}

      {error && <p role="alert" className="px-4 pb-4 text-sm text-red-600">{error}</p>}
    </>
  );
}
