import { Context, SelectorData, shallowEqual } from "ivi-core";
import { Component, ComponentClass, StatelessComponent } from "./component";
import { ConnectDescriptor } from "./connect_descriptor";
import { VNodeFlags, VNode, vNodeEqualKeys } from "./vnode";
import { renderOpenElement } from "./render";
import { escapeText } from "./escape";

/**
 * Blueprint Node.
 */
export class BlueprintNode {
  /**
   * Virtual DOM node that were used to create this node.
   */
  vnode: VNode<any>;
  /**
   * See `VNodeFlags` for details.
   */
  flags: VNodeFlags;
  /**
   * Prerendered string.
   */
  string: string;
  /**
   * Children nodes.
   */
  children: | BlueprintNode[] | BlueprintNode | string | number | boolean | null;
  /**
   * Additional data.
   *
   * Component instances for component nodes, and Selector data for connectors.
   */
  data: Component | SelectorData | null;
  /**
   * Children index for explicit keys.
   */
  childrenKeyIndex: Map<any, BlueprintNode> | null;
  /**
   * Children index for positional keys.
   */
  childrenPosIndex: Map<any, BlueprintNode> | null;

  constructor(
    vnode: VNode,
    children: | BlueprintNode[] | BlueprintNode | string | number | boolean | null,
    data: Component | SelectorData | null,
  ) {
    this.vnode = vnode;
    this.flags = vnode._flags;
    this.string = "";
    this.children = children;
    this.data = data;

    let childrenKeyIndex = null;
    let childrenPosIndex = null;
    if ((vnode._flags & VNodeFlags.ChildrenArray) !== 0) {
      children = children as BlueprintNode[];
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if ((c.flags & VNodeFlags.Key) !== 0) {
          if (childrenKeyIndex === null) {
            childrenKeyIndex = new Map<any, BlueprintNode>();
          }
          childrenKeyIndex.set(c.vnode._key, c);
        } else {
          if (childrenPosIndex === null) {
            childrenPosIndex = new Map<any, BlueprintNode>();
          }
          childrenPosIndex.set(c.vnode._key, c);
        }
      }
    }

    this.childrenKeyIndex = childrenKeyIndex;
    this.childrenPosIndex = childrenPosIndex;
  }
}

/**
 * createBlueprintFromVNode creates a blueprint from Virtual DOM.
 *
 * @param vnode Virtual DOM node.
 * @param context Current context.
 * @returns Blueprint node.
 */
function createBlueprintFromVNode(vnode: VNode<any>, context: Context): BlueprintNode {
  const flags = vnode._flags;

  if ((flags & (VNodeFlags.Element | VNodeFlags.Text)) !== 0) {
    let childrenInstances = vnode._children as BlueprintNode[] | BlueprintNode | string | number | boolean | null;
    if ((flags & VNodeFlags.Element) !== 0) {
      if ((flags & (VNodeFlags.ChildrenVNode | VNodeFlags.ChildrenArray)) !== 0) {
        if ((flags & VNodeFlags.ChildrenArray) !== 0) {
          const children = vnode._children as VNode[];
          childrenInstances = new Array(children.length);
          for (let i = 0; i < children.length; i++) {
            childrenInstances[i] = createBlueprintFromVNode(
              children[i],
              context,
            );
          }
        } else {
          childrenInstances = createBlueprintFromVNode(
            vnode._children as VNode,
            context,
          );
        }
      }
    }
    return new BlueprintNode(
      vnode,
      childrenInstances,
      null,
    );
  } else { // ((flags & VNodeFlags.Component) !== 0)
    if (flags & VNodeFlags.ComponentClass) {
      const component = new (vnode._tag as ComponentClass)(vnode._props);
      const root = component.render();
      return new BlueprintNode(
        vnode,
        createBlueprintFromVNode(root, context),
        component,
      );
    } else { // ((node._flags & VNodeFlags.ComponentFunction) !== 0)
      if ((flags & (VNodeFlags.Connect | VNodeFlags.UpdateContext)) !== 0) {
        if ((flags & VNodeFlags.Connect) !== 0) {
          const connect = vnode._tag as ConnectDescriptor<any, any, any>;
          const selectData = connect.select(null, vnode._props, context);
          return new BlueprintNode(
            vnode,
            createBlueprintFromVNode(connect.render(selectData.out), context),
            selectData,
          );
        } else { // ((flags & VNodeFlags.UpdateContext) !== 0)
          return new BlueprintNode(
            vnode,
            createBlueprintFromVNode(vnode._children as VNode, Object.assign({}, context, vnode._props)),
            null,
          );
        }
      } else {
        const root = (vnode._tag as StatelessComponent)(vnode._props);
        return new BlueprintNode(
          vnode,
          createBlueprintFromVNode(root, context),
          null,
        );
      }
    }
  }
}

/**
 * cloneChangedBlueprintNode checks deep changes that can occur because of context changes, and if nothing is changed
 * it will reuse existing blueprint node.
 *
 * @param bp Blueprint node.
 * @param context Current context.
 * @returns Blueprint node.
 */
function cloneChangedBlueprintNode(bp: BlueprintNode, context: Context): BlueprintNode {
  const flags = bp.flags;
  let n;

  if ((flags & VNodeFlags.DeepConnect) !== 0) {
    if ((flags & VNodeFlags.Text | VNodeFlags.Element) !== 0) {
      if ((flags & VNodeFlags.Element) !== 0) {
        if ((flags & (VNodeFlags.ChildrenVNode | VNodeFlags.ChildrenArray)) !== 0) {
          if ((flags & VNodeFlags.ChildrenArray) !== 0) {
            const children = bp.children as BlueprintNode[];
            const newChildren = new Array(children.length);
            let dirty = false;
            for (let i = 0; i < children.length; i++) {
              const c = children[i];
              n = cloneChangedBlueprintNode(c, context);
              if (c !== n) {
                dirty = true;
              }
              newChildren[i] = n;
            }
            if (dirty === true) {
              return new BlueprintNode(
                bp.vnode,
                newChildren,
                null,
              );
            }
          } else { // ((flags & VNodeFlags.ChildrenVNode) !== 0)
            const child = bp.children as BlueprintNode;
            n = cloneChangedBlueprintNode(child, context);
            if (child !== n) {
              return new BlueprintNode(
                bp.vnode,
                n,
                null,
              );
            }
          }
        }
      }
      return bp;
    } else { // ((flags & VNodeFlags.Component) !== 0)
      if ((flags & VNodeFlags.ComponentClass) !== 0) {
        n = cloneChangedBlueprintNode(bp.children as BlueprintNode, context);
        if (bp.children === n) {
          return bp;
        }
        return new BlueprintNode(
          bp.vnode,
          n,
          null,
        );
      } else { // ((flags & VNodeFlags.ComponentFunction) !== 0)
        if ((flags & (VNodeFlags.Connect | VNodeFlags.UpdateContext)) !== 0) {
          if ((flags & VNodeFlags.Connect) !== 0) {
            const connect = bp.vnode._tag as ConnectDescriptor<any, any, any>;
            const prevSelectData = bp.data as SelectorData;
            const selectData = connect.select(
              prevSelectData,
              bp.vnode._props,
              context,
            );
            if (prevSelectData !== selectData) {
              n = diffBlueprintNode(
                bp.children as BlueprintNode,
                connect.render(selectData.out),
                context,
              );
              return new BlueprintNode(
                bp.vnode,
                n,
                selectData,
              );
            }
            n = cloneChangedBlueprintNode(bp.children as BlueprintNode, context);
            if (bp.children === n) {
              return bp;
            }
            return new BlueprintNode(
              bp.vnode,
              n,
              selectData,
            );
          } else { // ((flags & VNodeFlags.UpdateContext) !== 0)
            n = cloneChangedBlueprintNode(
              bp.children as BlueprintNode,
              Object.assign({}, context, bp.vnode._props),
            );
            if (bp.children === n) {
              return bp;
            }
            return new BlueprintNode(
              bp.vnode,
              n,
              null,
            );
          }
        } else {
          n = cloneChangedBlueprintNode(bp.children as BlueprintNode, context);
          if (bp.children === n) {
            return bp;
          }
          return new BlueprintNode(
            bp.vnode,
            n,
            null,
          );
        }
      }
    }
  }

  return bp;
}

/**
 * diffBlueprintNode performs a diff with blueprint node and when nothing is changed it will try to reuse existing
 * blueprint node instead of creating a new one.
 *
 * @param a Blueprint node.
 * @param b Virtual DOM node.
 * @param context Current context.
 * @returns Blueprint node.
 */
function diffBlueprintNode(a: BlueprintNode, b: VNode<any>, context: Context): BlueprintNode {
  const aVNode = a.vnode;
  const aFlags = a.flags;
  const bFlags = b._flags;
  let n;

  if (aVNode === b) {
    n = cloneChangedBlueprintNode(a, context);
    if (a === n) {
      return a;
    }
    return new BlueprintNode(
      b,
      n,
      a.data,
    );
  }

  if (
    ((aFlags ^ bFlags) & VNodeFlags.Syncable) === 0 &&
    aVNode._tag === b._tag &&
    (
      ((bFlags & VNodeFlags.LinkedBlueprint) !== 0) ||
      (((aFlags ^ bFlags) & VNodeFlags.Key) === 0 && aVNode._key === b._key)
    )
  ) {
    if ((aFlags & (VNodeFlags.Text | VNodeFlags.Element)) !== 0) {
      if ((aFlags & VNodeFlags.Text) !== 0) {
        if (a.children === b._children) {
          return a;
        } else {
          return new BlueprintNode(
            b,
            b._children as string,
            null,
          );
        }
      } else { // ((flags & VNodeFlags.Element) !== 0)
        n = a.children;
        if (a.vnode._children !== b._children) {
          if (b._children !== null) {
            n = diffBlueprintChildren(
              a,
              aFlags,
              b._flags,
              n as | BlueprintNode[] | BlueprintNode | string | number | null,
              b._children as | VNode[] | VNode | string | number,
              context,
            );
          } else {
            n = null;
          }
        } else {
          n = cloneChangedBlueprintNode(a, context).children;
        }

        if (
          a.vnode._className === b._className &&
          shallowEqual(a.vnode._props, b._props) === true &&
          shallowEqual(a.vnode._style, b._style) === true &&
          a.children === n
        ) {
          return a;
        }

        return new BlueprintNode(
          b,
          n,
          null,
        );
      }
    } else { // ((flags & VNodeFlags.Component) !== 0)
      if ((aFlags & VNodeFlags.ComponentClass) !== 0) {
        let component = (a.data as Component);
        if (component.isPropsChanged(a.vnode._props, b._props) === true) {
          component = new (b._tag as ComponentClass)(b._props);
          n = diffBlueprintNode(a.children as BlueprintNode, component.render(), context);
        } else {
          n = cloneChangedBlueprintNode(a.children as BlueprintNode, context);
        }
        if (a.children === n) {
          return a;
        }
        return new BlueprintNode(
          a.vnode,
          n,
          component,
        );
      } else { // ((flags & VNodeFlags.ComponentFunction) !== 0)
        if ((aFlags & (VNodeFlags.Connect | VNodeFlags.UpdateContext)) !== 0) {
          if ((aFlags & VNodeFlags.Connect) !== 0) {
            const connect = a.vnode._tag as ConnectDescriptor<any, any, any>;
            const prevSelectData = a.data as SelectorData;
            const selectData = connect.select(
              prevSelectData,
              a.vnode._props,
              context,
            );
            if (prevSelectData !== selectData) {
              n = diffBlueprintNode(
                a.children as BlueprintNode,
                connect.render(selectData.out),
                context,
              );
              return new BlueprintNode(
                a.vnode,
                n,
                selectData,
              );
            }
            n = cloneChangedBlueprintNode(a.children as BlueprintNode, context);
            if (a.children === n) {
              return a;
            }
            return new BlueprintNode(
              a.vnode,
              n,
              selectData,
            );
          } else { // ((flags & VNodeFlags.UpdateContext) !== 0)
            n = diffBlueprintNode(
              a.children as BlueprintNode,
              b._children as VNode<any>,
              Object.assign({}, context, a.vnode._props),
            );
            if (a.children === n) {
              return a;
            }
            return new BlueprintNode(
              a.vnode,
              n,
              null,
            );
          }
        } else {
          const component = (b._tag as StatelessComponent);
          if (
            ((aFlags & VNodeFlags.CheckChangedProps) === 0 &&
              a.vnode._props !== b._props) ||
            ((aFlags & VNodeFlags.CheckChangedProps) !== 0 &&
              component.isPropsChanged!(a.vnode._props, b._props) === true)
          ) {
            n = diffBlueprintNode(
              a.children as BlueprintNode,
              component(b._props),
              context,
            );
          } else {
            n = cloneChangedBlueprintNode(a.children as BlueprintNode, context);
          }

          if (a.children === n) {
            return a;
          }
          return new BlueprintNode(
            a.vnode,
            n,
            null,
          );
        }
      }
    }
  }

  return createBlueprintFromVNode(b, context);
}

/**
 * diffBlueprintChildren performs a diff on children and tries to find matching children.
 *
 * @param aParent Blueprint parent node.
 * @param aParentFlags Blueprint parent node flags.
 * @param bParentFlags Virtual DOM parent node flags.
 * @param a Blueprint children.
 * @param b Virtual DOM children.
 * @param context Current context.
 * @returns Blueprint children.
 */
function diffBlueprintChildren(
  aParent: BlueprintNode,
  aParentFlags: VNodeFlags,
  bParentFlags: VNodeFlags,
  a: BlueprintNode[] | BlueprintNode | string | number | null,
  b: VNode[] | VNode | string | number,
  context: Context,
): BlueprintNode[] | BlueprintNode | string | number | null {
  let i = 0;
  let node;

  if ((bParentFlags & VNodeFlags.ChildrenBasic) !== 0) {
    // children property will contain escaped text.
    return null;
  } else {
    if ((aParentFlags & (VNodeFlags.ChildrenVNode | VNodeFlags.ChildrenArray)) === 0) {
      if ((bParentFlags & VNodeFlags.ChildrenArray) !== 0) {
        b = b as VNode[];
        const nodes = new Array(b.length);
        do {
          nodes[i] = createBlueprintFromVNode(b[i++], context);
        } while (i < b.length);

        return nodes;
      } else { // ((bParentFlags & VNodeFlags.ChildrenVNode) !== 0)
        return createBlueprintFromVNode(b as VNode, context);
      }
    } else {
      if ((aParentFlags & VNodeFlags.ChildrenArray) !== 0) {
        a = a as BlueprintNode[];
        if ((bParentFlags & VNodeFlags.ChildrenArray) !== 0) {
          return diffBlueprintChildrenTrackByKeys(
            aParent.childrenKeyIndex,
            aParent.childrenPosIndex,
            a,
            b as VNode[],
            context,
          );
        } else {
          b = b as VNode;
          for (; i < a.length; i++) {
            node = a[i];
            if (vNodeEqualKeys(node.vnode, b)) {
              return diffBlueprintNode(node, b, context);
            }
          }
          return createBlueprintFromVNode(b, context);
        }
      } else { // ((aParentFlags & VNodeFlags.ChildrenVNode) !== 0) {
        a = a as BlueprintNode;
        if ((bParentFlags & VNodeFlags.ChildrenArray) !== 0) {
          b = b as VNode[];
          const nodes = new Array(b.length);
          for (i = 0; i < b.length; i++) {
            node = b[i];
            nodes[i] = vNodeEqualKeys(a.vnode, node) ?
              diffBlueprintNode(a, node, context) :
              createBlueprintFromVNode(node, context);
          }
          return nodes;
        } else {
          return diffBlueprintNode(a, b as VNode, context);
        }
      }
    }
  }
}

/**
 * diffBlueprintChildrenTrackByKeys performs a diff on children lists and tries to find similar nodes with matching
 * keys.
 *
 * @param keyIndex Children index for explicit keys.
 * @param posIndex Children index for positional keys.
 * @param a Blueprint nodes.
 * @param b Virtual DOM nodes.
 * @param context Current context.
 * @returns Blueprint children.
 */
function diffBlueprintChildrenTrackByKeys(
  keyIndex: Map<any, BlueprintNode> | null,
  posIndex: Map<any, BlueprintNode> | null,
  a: BlueprintNode[],
  b: VNode[],
  context: Context,
): BlueprintNode[] {
  const newChildren = new Array(b.length);
  let synced = 0;
  let dirty = false;

  for (let i = 0; i < b.length; i++) {
    let aNode;
    const bNode = b[i];
    if ((bNode._flags & VNodeFlags.Key) !== 0) {
      if (keyIndex !== null) {
        aNode = keyIndex.get(bNode._key);
      }
    } else {
      if (posIndex !== null) {
        aNode = posIndex.get(bNode._key);
      }
    }

    let n;
    if (aNode === undefined) {
      n = createBlueprintFromVNode(bNode, context);
    } else {
      n = diffBlueprintNode(aNode, bNode, context);
      if (aNode !== n) {
        dirty = true;
      }
      synced++;
    }
    newChildren[i] = n;
  }

  if (dirty === false && synced === a.length) {
    return a;
  }
  return newChildren;
}

/**
 * Prerender blueprint nodes.
 *
 * @param node Blueprint node.
 * @param componentNode Current component node.
 */
function prerenderBlueprint(node: BlueprintNode, componentNode?: BlueprintNode): void {
  const flags = node.flags;
  if ((flags & (VNodeFlags.Element | VNodeFlags.Component)) !== 0) {
    if ((flags & VNodeFlags.Element) !== 0) {
      if ((flags & VNodeFlags.Frozen) === 0) {
        node.string = renderOpenElement(node.vnode);
      }
      if (componentNode !== undefined) {
        componentNode.string += node.string;
      }
      if ((flags & VNodeFlags.VoidElement) === 0) {
        if (node.vnode._children !== null) {
          if ((flags & (VNodeFlags.ChildrenArray | VNodeFlags.ChildrenVNode)) !== 0) {
            if ((flags & VNodeFlags.ChildrenArray) !== 0) {
              const children = node.children as BlueprintNode[];
              for (let i = 0; i < children.length; i++) {
                const c = children[i];
                prerenderBlueprint(c, componentNode);
                node.flags |= c.flags & VNodeFlags.DeepConnect;
              }
            } else {
              const c = node.children as BlueprintNode;
              prerenderBlueprint(c, componentNode);
              node.flags |= c.flags & VNodeFlags.DeepConnect;
            }
          } else {
            if ((flags & VNodeFlags.Frozen) === 0) {
              node.children = escapeText(node.vnode._children as string | number);
            }
            if (componentNode !== undefined) {
              componentNode.string += node.children;
            }
          }
        }
        if (componentNode !== undefined) {
          componentNode.string += node.vnode._close;
        }
      }
    } else { // ((flags & VNodeFlags.Component) !== 0)
      const c = node.children as BlueprintNode;
      if ((flags & (VNodeFlags.UpdateContext | VNodeFlags.Connect)) === 0) {
        if ((flags & VNodeFlags.Frozen) === 0) {
          prerenderBlueprint(c, node);
          node.flags |= c.flags & VNodeFlags.DeepConnect;
        }
        if (componentNode !== undefined) {
          componentNode.string += node.string;
        }
      } else {
        prerenderBlueprint(c, componentNode);
        if ((flags & VNodeFlags.Frozen) === 0) {
          if ((flags & VNodeFlags.Connect) === 0) {
            node.flags |= c.flags & VNodeFlags.DeepConnect;
          } else {
            node.flags |= VNodeFlags.DeepConnect;
          }
        }
      }
    }
  } else { // (((flags & VNodeFlags.Text) !== 0)
    if ((flags & VNodeFlags.Frozen) === 0) {
      node.string = escapeText(node.children as string | number);
    }
    if (componentNode !== undefined) {
      componentNode.string += node.string;
    }
  }

  if ((flags & VNodeFlags.Frozen) === 0) {
    node.flags |= VNodeFlags.Frozen;
  }
}

/**
 * createBlueprint creates a blueprint that can be used to optimize rendering to string.
 *
 * @param node Virtual DOM node.
 * @param context Context.
 * @param blueprint Blueprint that will be reused to reduce memory usage.
 * @returns Blueprint.
 */
export function createBlueprint(node: VNode<any>, context: Context = {}, blueprint?: BlueprintNode): BlueprintNode {
  const result = (blueprint === undefined) ?
    createBlueprintFromVNode(node, context) :
    diffBlueprintNode(blueprint, node, context);

  prerenderBlueprint(result);
  return result;
}

/**
 * linkBlueprint links blueprint to a component factory.
 *
 * Linked blueprint will be automatically for rendering components produced from this factory.
 *
 * @param componentFactory Component factory.
 * @param blueprint Blueprint node.
 */
export function linkBlueprint<P>(componentFactory: (props?: P) => VNode<P>, blueprint: BlueprintNode): void {
  (componentFactory as any).linkBlueprint(blueprint);
}
