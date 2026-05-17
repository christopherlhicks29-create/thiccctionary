/**
 * Buffer channel diagnostic. Prints the connection status of each channel
 * configured in BUFFER_PROFILE_IDS so we can see if IG (or any other)
 * has lapsed authorization with the underlying network (Meta, X, etc.).
 *
 * Run via .github/workflows/buffer-status.yml (workflow_dispatch).
 *
 * Required env vars:
 *   - BUFFER_ACCESS_TOKEN
 *   - BUFFER_PROFILE_IDS  ("twitter:ID,facebook:ID,instagram:ID")
 */

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

async function gql(query) {
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function listAllChannels() {
  // Buffer's `channels` query returns the user's connected channels with status.
  const query = `
    query Channels {
      channels {
        id
        service
        name
        avatar
        timezone
        isDisconnected
        organizationId
      }
    }
  `;
  const { status, json } = await gql(query);
  return { status, json };
}

async function main() {
  if (!process.env.BUFFER_ACCESS_TOKEN) {
    console.error('BUFFER_ACCESS_TOKEN not set');
    process.exit(1);
  }
  const configured = (process.env.BUFFER_PROFILE_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => {
      const i = s.indexOf(':');
      return i === -1 ? { service: null, channelId: s } : { service: s.slice(0, i).toLowerCase(), channelId: s.slice(i + 1) };
    });

  console.log(`Configured channels (from BUFFER_PROFILE_IDS): ${configured.length}`);
  configured.forEach(c => console.log(`  - ${c.service || '?'}: ${c.channelId}`));

  const { status, json } = await listAllChannels();
  console.log(`\nBuffer API status: ${status}`);
  if (json.errors) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  const channels = json.data?.channels || [];
  console.log(`Channels reported by Buffer: ${channels.length}\n`);

  console.log('=== ALL CHANNELS ON ACCOUNT ===');
  for (const ch of channels) {
    const flag = ch.isDisconnected ? '⚠ DISCONNECTED' : '✓ connected';
    console.log(`  [${flag}] ${ch.service.padEnd(20)} ${ch.id}, ${ch.name}`);
  }

  console.log('\n=== CONFIGURED-CHANNEL HEALTH ===');
  let problems = 0;
  for (const c of configured) {
    const found = channels.find(x => x.id === c.channelId);
    if (!found) {
      console.log(`  ✗ ${c.service}:${c.channelId}, NOT FOUND on this Buffer account (wrong ID or wrong account)`);
      problems++;
    } else if (found.isDisconnected) {
      console.log(`  ⚠ ${c.service}:${c.channelId}, DISCONNECTED. Re-authorize at https://publish.buffer.com/channels`);
      problems++;
    } else {
      console.log(`  ✓ ${c.service}:${c.channelId}, connected (${found.name})`);
    }
  }

  if (problems > 0) {
    console.log(`\n${problems} channel(s) need attention.`);
    process.exit(1);
  } else {
    console.log('\nAll configured channels look healthy.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
