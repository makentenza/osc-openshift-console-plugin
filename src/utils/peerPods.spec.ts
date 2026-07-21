import { parsePeerPodsBool } from './peerPods';

describe('parsePeerPodsBool', () => {
  it('reads the spelling the wizard itself writes', () => {
    expect(parsePeerPodsBool('true')).toBe(true);
    expect(parsePeerPodsBool('false')).toBe(false);
  });

  // A config map written by hand or by another tool is still a Go boolean to the cloud-api-adaptor,
  // so reading only 'false' would take DISABLECVM="False" to mean its opposite.
  it('accepts every spelling Go strconv.ParseBool does', () => {
    for (const yes of ['1', 't', 'T', 'TRUE', 'True', 'true']) {
      expect(parsePeerPodsBool(yes)).toBe(true);
    }
    for (const no of ['0', 'f', 'F', 'FALSE', 'False', 'false']) {
      expect(parsePeerPodsBool(no)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePeerPodsBool('  false  ')).toBe(false);
    expect(parsePeerPodsBool('\ttrue\n')).toBe(true);
  });

  // undefined means "the config map states no preference", so the caller's default applies.
  it('returns undefined for absent, empty, or unparseable values', () => {
    expect(parsePeerPodsBool(undefined)).toBeUndefined();
    expect(parsePeerPodsBool('')).toBeUndefined();
    expect(parsePeerPodsBool('   ')).toBeUndefined();
    expect(parsePeerPodsBool('yes')).toBeUndefined();
    expect(parsePeerPodsBool('2')).toBeUndefined();
  });
});
