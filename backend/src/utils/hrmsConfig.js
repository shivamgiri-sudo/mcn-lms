import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/hrms-mapping.json');

const DEFAULT_MAPPING = {
  branch: { table: 'branches', cols: { name: 'branch_name', code: 'branch_code', city: 'city', state: 'state', active: 'status' } },
  department: { table: 'departments', cols: { name: 'department_name', active: 'status' } },
  designation: { table: 'designations', cols: { title: 'designation_title', active: 'status' } },
  processlob: { table: 'process_lob_master', cols: { process: 'process', lob: 'lob', active: 'active' } },
};

export function loadMapping() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_MAPPING, ...parsed };
    }
  } catch (_) {}
  return { ...DEFAULT_MAPPING };
}

export function saveMapping(mapping) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(mapping, null, 2), 'utf-8');
  return true;
}

export { DEFAULT_MAPPING };
