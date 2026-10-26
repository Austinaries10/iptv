import { describe, expect, it } from 'vitest';
import { isLockedChannel, parseLockKeywords } from './plus-store';

describe('家长锁关键字', () => {
  it('解析中英文逗号分隔的关键字', () => {
    expect(parseLockKeywords(' Adult, XXX，成人 ,, ')).toEqual(['adult', 'xxx', '成人']);
  });

  it('分组名或台名命中即受保护', () => {
    const kws = parseLockKeywords('adult, 成人');
    expect(isLockedChannel({ name: 'Late Night', group: 'ADULT 18+' }, kws)).toBe(true);
    expect(isLockedChannel({ name: '成人频道' }, kws)).toBe(true);
    expect(isLockedChannel({ name: 'News', group: 'News' }, kws)).toBe(false);
    expect(isLockedChannel({ name: 'Adult Swim' }, [])).toBe(false);
  });
});
