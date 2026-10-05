grammar Common

// Shared terminals and data types. Has no entry rule: it is only imported by other metamodels.
Double returns number: FLOAT | INT;

// a number that may be negative: `-8.1`
SignedNumber returns number: '-'? (FLOAT | INT);

terminal FLOAT returns number: /[0-9]+\.[0-9]+/;
terminal INT returns number: /[0-9]+/;
// identifiers may contain hyphens (`stationobservation-layer`) but must start with a letter or underscore
terminal ID: /[_a-zA-Z][\w_-]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
