# Trophy Room — Stage 4 spot check

Six displayed records traced back to the raw Yahoo responses. For each, the
value is read out of Yahoo's own scoreboard payload and compared with what the
shard stored and what the ranking selected. The owner is re-resolved from the
raw response through `owners.json`, so a misattributed record would fail here.

The batting-average record is included deliberately: it comes from a season with
no at-bat count, which is the case the assumed qualifier admits.

| Record | Owner | Season, week | Yahoo raw | Shard | Board | Result |
|---|---|---|---|---|---|---|
| Best HR | Mark (Slippery Horse) | 2016 week 13 | `21` | 21 | 21 | match |
| Best ERA | Nick (My Cousin Vinnie P) | 2024 week 5 | `0.38` | 0.38 | 0.38 | match |
| Worst WHIP | Mark (Slippery Horse) | 2013 week 5 | `2.13` | 2.13 | 2.13 | match |
| Best K | mike (Braun Burgundy) | 2011 week 23 | `111` | 111 | 111 | match |
| Worst R | Jamison (Xander Onatopp) | 2016 week 23 | _(empty)_ | 0 | 0 | match, empty because no games were completed |
| Best AVG | Galen (mannys still stoned) | 2013 week 18 | `.388` | 0.388 | 0.388 | match |

All 6 records agree with Yahoo's raw payload. Five match value for value; the fifth is the week in which a team started nobody, where Yahoo returns an empty string and the shard stores the zero it represents. That case is accepted only when the team also reports no completed games, so a genuine gap could not pass as a zero.
