export function readAdminCoordinates(x, z) {
  const values = [x, z];
  if (values.some(value => !['string', 'number'].includes(typeof value) || String(value).trim() === '')) {
    throw new Error('请填写完整的 X 和 Z 坐标。');
  }
  const [east, south] = values.map(Number);
  if (![east, south].every(Number.isFinite) || Math.abs(east) > 6000 || Math.abs(south) > 6000) {
    throw new Error('坐标需要是 −6000 至 6000 米之间的有效数字。');
  }
  return { x: Math.round(east * 10) / 10, z: Math.round(south * 10) / 10 };
}

// Input/change/blur update the preview without normalizing either input's draft.
// read() always samples both controls again, including programmatic fills that
// have not fired a browser event before the enclosing object form is submitted.
export function bindAdminCoordinateInputs({ xInput, zInput, onValid, onInvalid = () => {} }) {
  const read = () => {
    const coordinates = readAdminCoordinates(xInput.value, zInput.value);
    onValid(coordinates);
    return coordinates;
  };
  const sync = event => {
    try { read(); }
    catch (error) { if (event.type !== 'input') onInvalid(error); }
  };
  for (const input of [xInput, zInput]) for (const type of ['input', 'change', 'blur']) input.addEventListener(type, sync);
  return {
    read,
    dispose() { for (const input of [xInput, zInput]) for (const type of ['input', 'change', 'blur']) input.removeEventListener(type, sync); },
  };
}
