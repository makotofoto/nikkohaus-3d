// 太陽位置（NOAA 近似公式，誤差約 1°）：回傳高度角、方位角（度，方位角從北順時針）
const D = Math.PI / 180;

export function solar(doy, hours, lat, lon, tz) {
  const g = 2 * Math.PI / 365 * (doy - 1 + (hours - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hours * 60 + eqt + 4 * lon - 60 * tz;
  const ha = (tst / 4 - 180) * D, la = lat * D;
  const cosZ = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  const el = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / D;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) / D + 180 + 360) % 360;
  return { el, az };
}

// 日出、日落（太陽上緣碰到地平線，-0.833°），以小時表示
export function sunTimes(doy, lat, lon, tz) {
  let rise = null, set = null, prev = solar(doy, 0, lat, lon, tz).el;
  for (let m = 1; m <= 1440; m++) {
    const e = solar(doy, m / 60, lat, lon, tz).el;
    if (prev < -0.833 && e >= -0.833) rise = m / 60;
    if (prev >= -0.833 && e < -0.833) set = m / 60;
    prev = e;
  }
  return { rise, set };
}

// 一年中的第幾天 ↔ 月、日
const MD = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function doyToMD(doy) {
  let m = 0; while (m < 11 && doy > MD[m]) { doy -= MD[m]; m++; }
  return [m + 1, doy];
}
export function mdToDoy(m, d) { let n = d; for (let i = 0; i < m - 1; i++) n += MD[i]; return n; }

export const COMPASS = ['北', '北偏東', '東北', '東偏北', '東', '東偏南', '東南', '南偏東', '南', '南偏西', '西南', '西偏南', '西', '西偏北', '西北', '北偏西'];
export const compassName = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
