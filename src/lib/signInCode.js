// The sign-in code Polar emails when AI Credits are connected: letters and
// digits, shown one per box by components/CodeInput.jsx.
export const CODE_LENGTH = 6;

export const cleanCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// The code with any unfilled boxes removed, ready to send.
export const codeValue = (value) => cleanCode(value);
export const isCodeComplete = (value) => codeValue(value).length === CODE_LENGTH;
