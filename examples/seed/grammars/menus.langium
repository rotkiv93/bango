grammar Menus
import './common'

// Menus: the navigation of the product, as the platform lays it out: menus (`top`, `left`, `right`) of items that open a view or group more items.
//
// An item is a view of one of the product's screens, or a group of items (the rule is recursive). Who can see it is `access`.
entry MenuModel: 'menus' (menus+=Menu)*;

// A menu is a named tree of items: the platform's menus are called `top`, `left` and `right` by where they are
Menu: 'menu' name=Name '{' (items+=MenuItem)* '}';

MenuItem: MenuGroup | MenuView;

MenuGroup: 'menugroup' name=Name (access=MenuAccess)? '{' (items+=MenuItem)* '}';

// What a view opens: a screen of the platform: `openscreen` says which (LIST, MAP, STATIC, USER_MANAGEMENT...), and what it shows (a list, a map, a page...)
MenuView: 'menuview' name=Name 'openscreen' component=ID view=STRING (access=MenuAccess)?;

// Who sees the item: administrators, anybody logged in, anybody who is not (a sign-in page)
MenuAccess: 'accessBy' (admin?='byAdmin')? (logged?='byLogged')? (anonymous?='byAnonymous')?;
