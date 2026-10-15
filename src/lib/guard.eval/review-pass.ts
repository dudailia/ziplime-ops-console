// 30 support sentences the pre-ship review of 15 Oct wrote against the tuned
// patterns, every one of which they blocked. Written by someone who had read
// the patterns, so this is training data, not a held-out set: it was used to
// narrow the patterns, and is not part of any reported rate.

export const REVIEW_PASS: readonly string[] = [
  "Stock prices can fall as well as rise, and you could lose money.",
  "If the price should drop below your stop, the stop order triggers.",
  "Short positions are not supported in the dry run.",
  "Buy and sell orders both go through the same risk limits.",
  "Close out of the app and log back in.",
  "Switch from Safari to Chrome and try again.",
  "Swap your API key for the new one in the forwarder config.",
  "Dump the log file and send it to us.",
  "Grab some screenshots and send them over.",
  "The next run will pick up more lines from the file.",
  "My advice: restart the forwarder first.",
  "Steer clear of the old v1 endpoint, it is going away.",
  "The entry point is run_live_trading in ziplime.",
  "I'd trim the allowlist to two entries.",
  "We'd pick up the fix in the next release.",
  "Be sure to make a backup of the file first.",
  "Your money is safe; this was only a display bug.",
  "The forwarder never loses a line, it retries until the console has it.",
  "You'll be up and running in five minutes.",
  "You will not lose any data when you restart.",
  "If someone else has access to your email, change your password.",
  "Please don't share your API key with other people.",
  "Log in with a different account and try again.",
  "Take profit orders are not supported in dry run.",
  "The upload can't fail silently; you will see an error.",
  "Higher returns usually come with higher risk.",
  "Restart the forwarder, it will recover\nTrading data then catches up.",
  "The best time to add the key is before the open.",
  "You can expect to make one request per batch.",
  "The index can drop rows when the file is rotated.",
];
