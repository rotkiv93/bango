grammar Common

// Shared terminals and data types. Has no entry rule: it is only imported by other metamodels.
Double returns number: FLOAT | INT;

// a number that may be negative: `-8.1`
SignedNumber returns number: '-'? (FLOAT | INT);

// a name that may have spaces (`Customer Form`): a word, or a text in quotes, which stays in quotes in the name and in the references to it
Name returns string: ID | STRING;

terminal FLOAT returns number: /[0-9]+\.[0-9]+/;
terminal INT returns number: /[0-9]+/;
// identifiers may contain hyphens (`stationobservation-layer`) and accented letters (`páginas`) but must start with a letter or underscore
terminal ID: /[_a-zA-Z\u00C0-\u024F][\w\u00C0-\u024F_-]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
