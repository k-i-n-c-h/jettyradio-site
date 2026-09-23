CREATE TABLE episode_tag_bank (name TEXT PRIMARY KEY);
CREATE TABLE episode_tags (
  media_id INTEGER NOT NULL,
  media_path TEXT NOT NULL,
  tag TEXT NOT NULL REFERENCES episode_tag_bank(name),
  PRIMARY KEY (media_id, media_path, tag)
);
