// Month labels in both source sheets can carry the actual data cutoff.
// Never silently replace an explicit but invalid cutoff with the month end.
export function monthCutoff(period, labels) {
  const match = String(period).match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error(`Invalid month: ${period}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cutoffs = new Set();
  for (const label of new Set(labels.map(String))) {
    const marker = label.match(/截[至止]\s*[:：]?\s*(.*)/);
    if (!marker) continue;
    const date = marker[1].match(/^(?:(20\d{2})\s*(?:年|[-/.])\s*)?(?:(\d{1,2})\s*(?:月|[-/.])\s*)?(\d{1,2})(?:\s*[日号]|(?=\s|[）)]|$))/);
    if (!date) throw new Error(`Unrecognized cutoff in ${period}: ${label}`);
    const day = Number(date[3]);
    if ((date[1] && Number(date[1]) !== year) || (date[2] && Number(date[2]) !== month)
      || day < 1 || day > lastDay) {
      throw new Error(`Invalid cutoff in ${period}: ${label}`);
    }
    cutoffs.add(`${period}-${String(day).padStart(2, '0')}`);
  }
  if (cutoffs.size > 1) throw new Error(`Conflicting cutoffs in ${period}: ${[...cutoffs].join(', ')}`);
  return [...cutoffs][0] || `${period}-${String(lastDay).padStart(2, '0')}`;
}
