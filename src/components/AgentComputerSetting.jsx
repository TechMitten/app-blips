import { useEffect, useState } from 'react';
import { SettingRow, Switch } from './SettingControls';
import { computerStatus, isComputerEnabled, setComputerEnabled } from '../lib/computer';

// Settings → Connectors → Agent computer: the on/off switch for the small
// cloud computer the AI uses to run npm (lib/computer.js).
export default function AgentComputerSetting() {
  const [enabled, setEnabled] = useState(isComputerEnabled);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let live = true;
    computerStatus().then((status) => {
      if (live && status && status.available === false) setAvailable(false);
    });
    return () => { live = false; };
  }, []);

  const toggle = (next) => {
    setEnabled(next);
    setComputerEnabled(next);
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-surface p-4">
      <SettingRow
        id="agent-computer-label"
        title="Agent computer"
        description={available
          ? 'Lets the AI run npm on a small AppBlips computer in the cloud: install packages properly, check that they exist, and test that an imported project builds. Package names and versions are sent to computer.appblips.com; testing a build uploads that project’s source code, and asks you first.'
          : 'Not available right now. This copy of AppBlips has the agent computer switched off.'}
      >
        <Switch checked={enabled && available} onChange={toggle} labelledBy="agent-computer-label" disabled={!available} />
      </SettingRow>
    </div>
  );
}
