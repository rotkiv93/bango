import { URI, type LangiumDocument } from 'langium';

// Every document of Bango lives at `memory:/<name>.<extension>`: grammars as `<grammar>.langium`, instances as
// `<metamodel>.<extension>`. These are the only places that know that shape.

export const documentUri = (name: string, extension: string) => URI.parse(`memory:/${name}.${extension}`);

/** `/datamodel.dm` -> `datamodel` */
export const nameOfPath = (path: string) => decodeURIComponent(path.replace(/^\//, '')).replace(/\.[^.]+$/, '');

export const nameOfDocument = (doc: LangiumDocument) => nameOfPath(doc.uri.path);

/** `memory:/datamodel.dm` (a URI as a string, e.g. from an LSP result) -> `datamodel` */
export const nameOfUri = (uri: string) => nameOfPath(uri.replace(/^memory:/, ''));
