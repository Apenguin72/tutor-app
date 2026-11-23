// 測試用的固定資料（對應 docs/parser-cases.md）
export const NOW = { date: '2026-11-23', time: '16:00' };

export function makeData() {
  return {
    version: 1,
    settings: { visibleDays: [0, 1, 2, 3, 4, 5, 6], dayStart: '08:00', dayEnd: '22:00', lastBackupAt: null },
    students: [
      {
        id: 's1', code: '001', name: '王小明', parentName: '王媽媽', phone: '0912345678', grade: '國二', address: '', fee: 800, feeUnit: 'hour', note: '',
        slots: [
          { id: 't1a', wd: 2, start: '18:00', duration: 90, subjects: ['數學'], validFrom: null, validTo: null },
          { id: 't1b', wd: 5, start: '14:00', duration: 120, subjects: ['數學', '英文'], validFrom: null, validTo: null },
        ],
      },
      {
        id: 's2', code: '002', name: '林小美', parentName: '林爸爸', phone: '0987654321', grade: '高一', address: '', fee: 1000, feeUnit: 'lesson', note: '',
        slots: [
          { id: 't2a', wd: 1, start: '19:00', duration: 60, subjects: ['英文'], validFrom: null, validTo: null },
          { id: 't2b', wd: 3, start: '19:00', duration: 60, subjects: ['英文'], validFrom: null, validTo: null },
        ],
      },
      {
        id: 's3', code: '003', name: '陳大同', parentName: '陳媽媽', phone: '0922333444', grade: '國三', address: '', fee: 900, feeUnit: 'hour', note: '',
        slots: [
          { id: 't3a', wd: 0, start: '17:30', duration: 90, subjects: ['理化'], validFrom: null, validTo: null },
        ],
      },
    ],
    overrides: {},
    extras: [],
    stops: [],
    chat: [],
    log: [],
  };
}
