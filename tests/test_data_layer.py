"""数据层测试。重点是 data-model.md §2 那三条不变量——它们是权限模型的全部内容。

    python tests/test_data_layer.py
"""

import json
import os
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

from proxy import auth                                               # noqa: E402
from proxy.app import Deps, handle                                   # noqa: E402
from proxy.db import Database, SqliteContext, SqliteHistory          # noqa: E402
from proxy.ports import PermissionDenied                             # noqa: E402

VERSION = (ROOT / "prompts" / "VERSION").read_text(encoding="utf-8").strip()

TABLES = {"users", "videos", "storyboards", "entries", "access_grants",
          "share_links", "chat_messages", "screening_results", "review_votes"}


class FakeClient:
    chat_model = "fake-model"

    def __init__(self, reply="ok"):
        self.reply = reply
        self.calls = []

    def call(self, role, system, content, history=()):
        self.calls.append({"role": role, "content": content, "history": list(history)})
        return self.reply


class Fixture(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.context = SqliteContext(self.db)
        self.history = SqliteHistory(self.db)
        self.owner = self.db.add_user("owner")
        self.guest = self.db.add_user("guest")
        self.storyboard = self.db.add_storyboard(self.owner, "Fence at number 12")
        self.db.grant(self.storyboard, self.guest, "contribute", self.owner)


class Schema(Fixture):
    def test_tables_come_from_the_generated_schema(self):
        self.assertEqual(TABLES, self.db.tables())

    @unittest.skipUnless((ROOT / "docs" / "data-model.md").exists(),
                         "docs/ 不进仓库，clone 下来通常没有")
    def test_schema_sql_has_not_drifted_from_the_doc(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import build_schema
        self.assertEqual(build_schema.render(),
                         (ROOT / "schema.sql").read_text(encoding="utf-8"))

    def test_species_constraint_is_live(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.add_entry(self.storyboard, self.owner, "dog")

    def test_foreign_keys_are_enforced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.add_entry("no-such-storyboard", self.owner, "brushtail")

    def test_owner_can_reach_their_own_storyboard(self):
        context = self.context.build(self.owner, self.storyboard)
        self.assertTrue(context["storyboard_visible_to_this_user"])


class InvariantOne(Fixture):
    """author_id != requester_id 的内容永远不进 context。"""

    def test_other_peoples_entries_are_not_returned(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine, on the fence")
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="theirs, in the tree")
        context = self.context.build(self.owner, self.storyboard)
        stories = [entry["story"] for entry in context["own_entries"]]
        self.assertEqual(["mine, on the fence"], stories)

    def test_other_peoples_entries_never_reach_the_model(self):
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="SECRET FROM THE NEIGHBOUR")
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine, on the fence")
        client = FakeClient("sure")
        deps = Deps(client=client, history=self.history, context=self.context)
        status, _ = handle({"role": "neighbour", "storyboard_id": self.storyboard,
                            "message": "what have people written here?"},
                           auth.issue(self.owner), deps)
        self.assertEqual(200, status)
        sent = json.dumps(client.calls[0], ensure_ascii=False)
        self.assertIn("mine, on the fence", sent)
        self.assertNotIn("SECRET FROM THE NEIGHBOUR", sent)

    def test_species_falls_back_to_unknown_without_entries(self):
        self.assertEqual("unknown", self.context.build(self.owner, self.storyboard)["species_selected"])

    def test_species_follows_the_latest_own_entry(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail")
        self.db.add_entry(self.storyboard, self.owner, "ringtail")
        self.assertEqual("ringtail", self.context.build(self.owner, self.storyboard)["species_selected"])


class InvariantTwo(Fixture):
    """软删的 entry 立即消失，不吃缓存。"""

    def test_soft_deleted_entry_disappears_on_the_next_call(self):
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="about to go")
        self.assertEqual(1, len(self.context.build(self.owner, self.storyboard)["own_entries"]))
        self.db.soft_delete_entry(entry)
        self.assertEqual([], self.context.build(self.owner, self.storyboard)["own_entries"])

    def test_deleted_entry_does_not_set_the_species(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail")
        gone = self.db.add_entry(self.storyboard, self.owner, "ringtail")
        self.db.soft_delete_entry(gone)
        self.assertEqual("brushtail", self.context.build(self.owner, self.storyboard)["species_selected"])


class InvariantThree(Fixture):
    """撤销的 grant 立即失效，该分区的聊天记录同时停读。"""

    def test_revoked_grant_denies_context_immediately(self):
        self.context.build(self.guest, self.storyboard)          # 撤销前拿得到
        self.db.revoke(self.storyboard, self.guest)
        with self.assertRaises(PermissionDenied):
            self.context.build(self.guest, self.storyboard)

    def test_revoked_grant_stops_the_history_partition(self):
        self.history.append(self.guest, self.storyboard, "user", "earlier question")
        self.assertEqual(1, len(self.history.recent(self.guest, self.storyboard)))
        self.db.revoke(self.storyboard, self.guest)
        self.assertEqual([], self.history.recent(self.guest, self.storyboard))

    def test_revoked_user_gets_403_from_the_endpoint(self):
        self.db.revoke(self.storyboard, self.guest)
        deps = Deps(client=FakeClient(), history=self.history, context=self.context)
        status, payload = handle({"role": "neighbour", "storyboard_id": self.storyboard,
                                  "message": "what did I write?"}, auth.issue(self.guest), deps)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_regrant_brings_the_partition_back(self):
        self.history.append(self.guest, self.storyboard, "user", "earlier question")
        self.db.revoke(self.storyboard, self.guest)
        self.db.grant(self.storyboard, self.guest, "view", self.owner)
        self.assertEqual(1, len(self.history.recent(self.guest, self.storyboard)))


class History(Fixture):
    def test_history_is_partitioned_by_storyboard(self):
        other = self.db.add_storyboard(self.owner)
        self.history.append(self.owner, other, "user", "line from the other storyboard")
        self.history.append(self.owner, self.storyboard, "user", "line from this one")
        recent = self.history.recent(self.owner, self.storyboard)
        self.assertEqual(["line from this one"], [m["content"] for m in recent])

    def test_history_keeps_the_last_six(self):
        for i in range(10):
            self.history.append(self.owner, self.storyboard, "user", f"line {i}")
        recent = self.history.recent(self.owner, self.storyboard)
        self.assertEqual(6, len(recent))
        self.assertEqual("line 9", recent[-1]["content"])

    def test_prompt_version_and_model_are_stored(self):
        deps = Deps(client=FakeClient("a reply"), history=self.history, context=self.context)
        handle({"role": "neighbour", "storyboard_id": self.storyboard, "message": "hello"},
               auth.issue(self.owner), deps)
        row = self.db.conn.execute(
            "SELECT role, prompt_version, model FROM chat_messages WHERE role = 'assistant'").fetchone()
        self.assertEqual(VERSION, row["prompt_version"])
        self.assertEqual("fake-model", row["model"])

    def test_archiving_drops_the_partition(self):
        self.history.append(self.owner, self.storyboard, "user", "will be archived")
        self.history.drop_partition(self.owner, self.storyboard)
        self.assertEqual([], self.history.recent(self.owner, self.storyboard))


if __name__ == "__main__":
    unittest.main()
