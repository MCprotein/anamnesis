"""Free local failure-path tests; never start Codex or access account auth."""
import asyncio
import pathlib
import sys
import tempfile
import unittest
from codex_continuity_runtime import Runtime


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, program, expected):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            runtime = Runtime(root / 'home', root, root / 'events.jsonl')
            runtime.p = await asyncio.create_subprocess_exec(
                sys.executable, '-c', program,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            runtime.reader = asyncio.create_task(runtime.read())
            try:
                with self.assertRaisesRegex(RuntimeError, expected):
                    await runtime.wait(lambda event: False, timeout=3)
                if expected == 'Malformed':
                    self.assertTrue(pathlib.Path(str(runtime.log) + '.malformed').exists())
            finally:
                await asyncio.wait_for(runtime.stop(), 12)
            self.assertIsNotNone(runtime.p.returncode)
            self.assertTrue(runtime.reader.done())

    async def test_malformed_record_is_retained_and_fails(self):
        await self.exercise("print('not JSON', flush=True); import time; time.sleep(30)", 'Malformed')

    async def test_eof_fails_waiters_and_already_exited_cleanup(self):
        await self.exercise('pass', 'EOF')

    async def test_unresponsive_owned_process_is_killed(self):
        await self.exercise("import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('not JSON', flush=True); time.sleep(30)", 'Malformed')


if __name__ == '__main__':
    unittest.main()
