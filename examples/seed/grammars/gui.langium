grammar Gui
import './common'

// Interface: the look of the product's screens. `design` says where its menus are (1 top, 2 top and left, 3 top and right, 4 none, 5 left, 6 right); the header shows the name of the product.
entry GuiModel: 'gui' ('design' design=STRING)? ('font' family=STRING size=STRING)? ('colors' colors+=STRING (',' colors+=STRING)*)?;
