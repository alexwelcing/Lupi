import { describe, expect, it } from 'vitest';
import { nodePathLabel, nodePathTitle, scrubHomePaths } from './nodePath';

const HOME = /\/home\/[^/]+\/|\/Users\/[^/]+\/|[A-Za-z]:\\Users\\/;

describe('knowledge node paths', () => {
  it('prints a home path from the home directory on', () => {
    expect(nodePathLabel('hermes-core://config//home/alex/.hermes/SOUL.md')).toBe('~/.hermes/SOUL.md');
    expect(nodePathTitle('hermes-core://config//home/alex/.hermes/SOUL.md')).toBe('hermes-core://config/~/.hermes/SOUL.md');
  });

  it('folds .. segments after the home directory', () => {
    const id = 'lupine-public://file//home/alex/Dev/lupine/lupine/../lupine-science/.env';
    expect(nodePathLabel(id)).toBe('~/Dev/lupine/lupine-science/.env');
    expect(nodePathTitle(id)).toBe('lupine-public://file/~/Dev/lupine/lupine-science/.env');
  });

  it('scrubs macOS and Windows home directories too', () => {
    expect(scrubHomePaths('/Users/sam/Projects/lupi/README.md')).toBe('~/Projects/lupi/README.md');
    expect(scrubHomePaths('C:\\Users\\sam\\notes.txt')).toBe('~\\notes.txt');
    expect(nodePathLabel('repo://repo//Users/sam/code')).toBe('~/code');
  });

  it('keeps an id without a home directory as it was, without its scheme', () => {
    expect(nodePathLabel('lupine-research://claim/S5')).toBe('claim/S5');
    expect(nodePathTitle('lupine-research://claim/S5')).toBe('lupine-research://claim/S5');
    expect(scrubHomePaths('/srv/lupi/data.json')).toBe('/srv/lupi/data.json');
    expect(scrubHomePaths('a/homework/b')).toBe('a/homework/b');
  });

  it('shortens long paths to their last segment, and never shows a home path', () => {
    const id = 'lupine-science://file//home/alex/Dev/lupine/lupine/glim-think/evals/fixtures/deep/nested/report.json';
    const label = nodePathLabel(id)!;
    expect(label.length).toBeLessThanOrEqual(42);
    expect(label.endsWith('/report.json')).toBe(true);
    expect(label).not.toMatch(HOME);
    expect(nodePathTitle(id)).not.toMatch(HOME);
  });

  it('returns undefined for no id', () => {
    expect(nodePathLabel(undefined)).toBeUndefined();
    expect(nodePathTitle('')).toBeUndefined();
  });
});
