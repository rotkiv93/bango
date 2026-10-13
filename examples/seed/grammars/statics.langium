grammar Statics
import './common'

// Static pages: pages of HTML that the product shows as they are (a home page, an about page...), each with a name that menus and links use.
entry StaticsModel: 'statics' name=ID? (pages+=StaticPage)*;

StaticPage: 'page' name=ID 'html' html=STRING;
