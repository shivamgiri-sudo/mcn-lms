import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api.js';

// Branch, process and LOB used to be free-text boxes on ten forms. Every typo minted
// a new branch, and because access control now keys on the branch string, a typo
// silently revokes access. One fetch per portal, cached, feeds every dropdown.
const EMPTY = { branches: [], processes: [], lobs: [], processLob: [] };
const cache = new Map();
const OrgOptionsContext = createContext(null);

async function loadOptions(portal) {
  if (cache.has(portal)) return cache.get(portal);
  const pending = api.get(`/${portal}/form-options`, portal).then(res => (res?.ok && res.data ? res.data : EMPTY));
  cache.set(portal, pending);
  const value = await pending;
  cache.set(portal, value);
  return value;
}

export function useOrgOptions(portal = 'admin') {
  const provided = useContext(OrgOptionsContext);
  const [options, setOptions] = useState(provided || EMPTY);

  useEffect(() => {
    if (provided) return undefined;
    let cancelled = false;
    loadOptions(portal).then(value => { if (!cancelled) setOptions(value); });
    return () => { cancelled = true; };
  }, [portal, provided]);

  return provided || options;
}

export function OrgOptionsProvider({ portal = 'admin', children }) {
  const options = useOrgOptions(portal);
  return <OrgOptionsContext.Provider value={options}>{children}</OrgOptionsContext.Provider>;
}

function Select({ label, value, onChange, options, placeholder, disabled, className = 'select', required, style }) {
  const current = value == null ? '' : String(value);
  // A record saved before this list existed can hold a value the master table no
  // longer offers. Showing it keeps the form honest instead of silently re-assigning.
  const list = useMemo(() => {
    if (!current || options.some(item => item.toLowerCase() === current.toLowerCase())) return options;
    return [current, ...options];
  }, [current, options]);

  return (
    <select
      className={className}
      value={current}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
      required={required}
      aria-label={label}
      style={style}
    >
      <option value="">{placeholder}</option>
      {list.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
  );
}

export function BranchSelect({ portal = 'admin', value, onChange, placeholder = 'Select branch', ...rest }) {
  const { branches } = useOrgOptions(portal);
  return <Select label="Branch" value={value} onChange={onChange} options={branches} placeholder={placeholder} {...rest} />;
}

export function ProcessSelect({ portal = 'admin', value, onChange, placeholder = 'Select process', ...rest }) {
  const { processes } = useOrgOptions(portal);
  return <Select label="Process" value={value} onChange={onChange} options={processes} placeholder={placeholder} {...rest} />;
}

// LOBs are defined per process, so once a process is chosen only its own LOBs are
// offered; with no process picked the full list stays available.
export function LobSelect({ portal = 'admin', value, onChange, process, placeholder = 'Select LOB', ...rest }) {
  const { lobs, processLob } = useOrgOptions(portal);
  const scoped = useMemo(() => {
    const chosen = String(process || '').trim().toLowerCase();
    if (!chosen) return lobs;
    const matched = processLob.filter(row => row.process.toLowerCase() === chosen).map(row => row.lob);
    return matched.length ? [...new Set(matched)].sort((a, b) => a.localeCompare(b)) : lobs;
  }, [lobs, processLob, process]);
  return <Select label="LOB" value={value} onChange={onChange} options={scoped} placeholder={placeholder} {...rest} />;
}
