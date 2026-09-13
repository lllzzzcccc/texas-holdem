/** 房间参数预设选项（创建房间与房主修改设置共用） */

export const BLIND_PRESETS = ['5/10', '10/20', '25/50', '50/100', '100/200'];

export const SEAT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9];

/** 出牌时间（秒，0 = 不限时） */
export const TURN_OPTIONS = [
  { value: 15, label: '15 秒' },
  { value: 20, label: '20 秒' },
  { value: 30, label: '30 秒' },
  { value: 45, label: '45 秒' },
  { value: 60, label: '60 秒' },
  { value: 0, label: '不限时' },
];

export const HAND_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 10, label: '10 手' },
  { value: 20, label: '20 手' },
  { value: 30, label: '30 手' },
  { value: 50, label: '50 手' },
];
