/**
 * Introspection helper. Asks Buffer's GraphQL API about the
 * input types we need for posting (especially video/Reel support).
 * Run via: node introspect-buffer.js
 */

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

async function introspect(typeName) {
  const query = `
    query I {
      __type(name: "${typeName}") {
        name
        inputFields {
          name
          type {
            name
            kind
            ofType { name kind ofType { name kind } }
          }
        }
      }
    }
  `;
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// Introspect all relevant types for video/Reel posting
for (const typeName of [
  'CreatePostInput',
  'AssetsInput',
  'ImageAssetInput',
  'VideoAssetInput',
  'VideoInput',
  'MediaInput',
]) {
  console.log(`\n=== ${typeName} ===`);
  const json = await introspect(typeName);
  console.log(JSON.stringify(json, null, 2));
}

// --- 2026-07-26: scheduling-schema chase -------------------------------
// Goal: find out, with evidence, how to pin a post to a specific date/time
// (instead of mode:'addToQueue', which queue-lags daily posts behind
// backlog). Dumps CreatePostInput's enums + likely scheduling types.

async function introspectEnum(typeName) {
  const query = `
    query E {
      __type(name: "${typeName}") {
        name
        kind
        enumValues { name description }
      }
    }
  `;
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

function collectTypeNames(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.name) out.add(node.name);
  collectTypeNames(node.ofType, out);
}

{
  const seen = new Set();
  const cpi = await introspect('CreatePostInput');
  for (const f of cpi?.data?.__type?.inputFields || []) {
    collectTypeNames(f.type, seen);
  }
  // Candidate scheduling-related types, whether or not referenced above.
  ['PostSchedulingType', 'SchedulingType', 'CreatePostMode', 'PostMode',
   'QueueMode', 'AddToQueueMode', 'DateTime', 'PostDueAtInput']
    .forEach(n => seen.add(n));

  for (const name of seen) {
    console.log(`\n=== enum/scalar chase: ${name} ===`);
    const json = await introspectEnum(name);
    console.log(JSON.stringify(json, null, 2));
  }
}
