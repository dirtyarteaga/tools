/**
 * @license
 * Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

'use strict';
import * as estraverse from 'estraverse';
import * as estree from 'estree';
import * as escodegen from 'escodegen';
import {BehaviorDescriptor, PropertyDescriptor} from '../ast/ast';

/**
 * Returns whether an Espree node matches a particular object path.
 *
 * e.g. you have a MemberExpression node, and want to see whether it represents
 * `Foo.Bar.Baz`:
 *
 *     matchesCallExpression(node, ['Foo', 'Bar', 'Baz'])
 *
 * @param {ESTree.Node} expression The Espree node to match against.
 * @param {Array<string>} path The path to look for.
 */
export function matchesCallExpression(
    expression: estree.MemberExpression, path: string[]): boolean {
  if (!expression.property || !expression.object) return;
  console.assert(path.length >= 2);

  if (expression.property.type !== 'Identifier') {
    return;
  }
  // Unravel backwards, make sure properties match each step of the way.
  if (expression.property.name !== path[path.length - 1]) return false;
  // We've got ourselves a final member expression.
  if (path.length === 2 && expression.object.type === 'Identifier') {
    return expression.object.name === path[0];
  }
  // Nested expressions.
  if (path.length > 2 && expression.object.type === 'MemberExpression') {
    return matchesCallExpression(
        expression.object, path.slice(0, path.length - 1));
  }

  return false;
}

/**
 * @param {Node} key The node representing an object key or expression.
 * @return {string} The name of that key.
 */
export function objectKeyToString(key: estree.Node): string {
  if (key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal') {
    return key.value.toString();
  }
  if (key.type === 'MemberExpression') {
    return objectKeyToString(key.object) + '.' +
        objectKeyToString(key.property);
  }
}

const CLOSURE_CONSTRUCTOR_MAP = {
  'Boolean': 'boolean',
  'Number': 'number',
  'String': 'string',
};

/**
 * AST expression -> Closure type.
 *
 * Accepts literal values, and native constructors.
 *
 * @param {Node} node An Espree expression node.
 * @return {string} The type of that expression, in Closure terms.
 */
export function closureType(node: estree.Node): string {
  if (node.type.match(/Expression$/)) {
    return node.type.substr(0, node.type.length - 10);
  } else if (node.type === 'Literal') {
    return typeof node.value;
  } else if (node.type === 'Identifier') {
    return CLOSURE_CONSTRUCTOR_MAP[node.name] || node.name;
  } else {
    throw {
      message: 'Unknown Closure type for node: ' + node.type,
      location: node.loc.start,
    };
  }
}

export function getAttachedComment(node: estree.Node): string {
  const comments = getLeadingComments(node) || getLeadingComments(node['key']);
  if (!comments) {
    return;
  }
  return comments[comments.length - 1];
}

/**
 * Returns all comments from a tree defined with @event.
 */
export function getEventComments(node: estree.Node) {
  let eventComments: string[] = [];
  estraverse.traverse(node, {
    enter: (node) => {
      const comments =
          (node.leadingComments || [])
              .concat(node.trailingComments || [])
              .map((commentAST) => commentAST.value)
              .filter((comment) => comment.indexOf('@event') !== -1);
      eventComments = eventComments.concat(comments);
    },
    keys: {Super: []}
  });
  // dedup
  return eventComments.filter(
      (el, index, array) => { return array.indexOf(el) === index; });
}

function getLeadingComments(node: estree.Node): string[] {
  if (!node) {
    return;
  }
  const comments = node.leadingComments;
  if (!comments || comments.length === 0) return;
  return comments.map(function(comment) { return comment.value; });
}

/**
 * Converts a estree Property AST node into its Hydrolysis representation.
 */
export function toPropertyDescriptor(node: estree.Property):
    PropertyDescriptor {
  let type = closureType(node.value);
  if (type === 'Function') {
    if (node.kind === 'get' || node.kind === 'set') {
      type = '';
      node[`${node.kind}ter`] = true;
    }
  }
  const result: PropertyDescriptor = {
    name: objectKeyToString(node.key),
    type: type,
    desc: getAttachedComment(node),
    javascriptNode: node
  };

  if (type === 'Function') {
    const value = <estree.Function>node.value;
    result.params = (value.params || []).map((param) => {
      // With ES6 we can have a constiety of param patterns. Best to leave the
      // formatting to escodegen.
      return {name: escodegen.generate(param)};
    });
  }

  return result;
}
