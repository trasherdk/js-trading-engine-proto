/* global BigInt */
/* eslint-disable-next-line no-extend-native */
BigInt.prototype.toJSON = function toJSON() {
  return { v: `${this}`, $type: 'BigInt' };
};

function jsonBigIntReviver(k, v, baseReviver) {
  if (typeof v === 'object' && v.$type === 'BigInt') {
    return BigInt(v.v);
  }

  if (baseReviver) {
    return baseReviver(k, v);
  }

  return v;
}

const originalJSONParse = JSON.parse;
JSON.parse = function parse(json, reviver) {
  if (!reviver) {
    return originalJSONParse.apply(JSON, [json, (k, v) => jsonBigIntReviver(k, v)]);
  }
  return originalJSONParse.apply(JSON, [json, (k, v) => jsonBigIntReviver(k, v, reviver)]);
};
