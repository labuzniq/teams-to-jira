// test/messageText.test.ts
import { htmlToText } from '../src/messageText';

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('converts block endings and <br> to newlines', () => {
    expect(htmlToText('<p>line one</p><p>line two</p>')).toBe('line one\nline two');
    expect(htmlToText('a<br>b<br/>c')).toBe('a\nb\nc');
  });

  it('decodes common HTML entities', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f')).toBe(
      'a & b <c> "d" \'e\' f'
    );
  });

  it('collapses 3+ newlines to two and trims', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\nb');
    expect(htmlToText('  <p> x </p> ')).toBe('x');
  });

  it('passes plain text through unchanged', () => {
    expect(htmlToText('just plain text')).toBe('just plain text');
  });
});
