# W&W Wiki

This is the independent Wiki and Git root at `D:/workspace/W&W Wiki`. The Godot game is the sibling project at `D:/workspace/weave-and-wander`. Game asset export scripts use `tools/wiki_paths.gd` in the game repository to write to this Wiki's `public/assets` directory.

Preserve staged, unstaged, and untracked changes. `data/records.json` and `public/media/` are local user data excluded from Git; never replace them with seed data or delete them during tests. Run Wiki checks from this directory with `npm run check` and `npm test`.