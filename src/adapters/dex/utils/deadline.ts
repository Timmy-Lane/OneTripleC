export function getDeadline(minutesFromNow: number = 20): bigint {
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + minutesFromNow * 60;
  return BigInt(deadline);
}
