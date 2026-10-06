# User Guide: Guided Debugging

## What it does

_What guided debugging is and what a student sees, in two or three sentences (#20)._

## How to use it

_Steps to try it on a small failing example: the example file, how to start OpenCode, what to ask, and what to choose at each prompt (#20)._

## How to test it

_Manual check: what to confirm when following the steps above (#20)._

_Automated tests: the command that runs all guided debugging tests, and what they cover (#20)._

## Contributions

This feature was built by Team T1 over two sprints. Each member owned one part, and the parts were connected through pull requests and code reviews.

**@Ahmed120515: Error context (#4).** _Description of the error context collector and a link to its tests._

**@belamigw: Error explanation (#5).** Added the `explain_error` tool. When something fails, it finds the error that just happened, picks out the file, line and error message, and rates how sure it is, so OpenCode can explain the cause without giving the fix. Tests in [`packages/opencode/test/tool/explain-error.test.ts`](packages/opencode/test/tool/explain-error.test.ts) check that it uses only the latest failure, finds the right file, never includes a fix, and is unsure when the error is unclear.

**@akkubais: Testing strategy (#6).** _Description of the testing strategy and a link to its tests._

**@hlabda: Guided debugging flow (#7).** _Description of the guided debugging flow and a link to its tests._

**@a-belard: Response format (#9).** _Description of the response format and a link to its tests._
