#!/usr/bin/env node
import {
  logout,
  logs,
  restart,
  runInBackground,
  start,
  status,
  stop,
} from './commands';

const HELP = `crewbot — run your agents from anywhere

Usage: crewbot <command>

  start        Link this computer (first time) and run crewbot in the background
  stop         Stop the background daemon and its agents
  restart      Restart the background daemon
  status       Show whether crewbot is running, connected, and which agents it found
  logs [-f]    Show the daemon log (-f to follow)
  logout       Stop crewbot, unlink this computer and delete its bots

Options:
  start --foreground   Run in the foreground instead (for debugging or systemd)
  logout --yes         Don't ask for confirmation

Then open https://super-agent.team/crew`;

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'start':
      await start({ foreground: args.includes('--foreground') });
      break;
    case 'stop':
      await stop();
      break;
    case 'restart':
      await restart();
      break;
    case 'status':
      await status();
      break;
    case 'logs':
      await logs({ follow: args.includes('-f') || args.includes('--follow') });
      break;
    case 'logout':
      await logout({ yes: args.includes('--yes') || args.includes('-y') });
      break;
    case '__run':
      await runInBackground();
      break;
    default:
      console.log(HELP);
      if (command && command !== 'help' && command !== '--help') {
        process.exitCode = 1;
      }
  }
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
}
