-- Existing projects start with no links (SQLite needs a default to add a NOT NULL column).
ALTER TABLE `projects` ADD `links` text DEFAULT '[]' NOT NULL;
