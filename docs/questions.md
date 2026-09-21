# Prepare and import questions

The application imports **UTF-8, comma-delimited CSV files**. Excel workbooks such as `.xlsx` and `.xls` cannot be uploaded directly.

Start with [examples/questions.csv](../examples/questions.csv). It contains four sample questions, uses each valid answer key once, and assigns every question to the `fabric-basics` pool.

## 1. Set up the worksheet

Open the sample in Excel or create a worksheet with the following headers in row 1. Enter one question per row, starting at row 2. Header spelling and capitalization must match exactly.

| Excel column | Header | Required | Cell value |
| --- | --- | --- | --- |
| A | `Category` | Yes | A question category, such as `Fabric` or `Power BI`. This is a label, not a pool assignment. |
| B | `Question` | Yes | The question text. |
| C | `Answer1` | Yes | The first answer choice. |
| D | `Answer2` | Yes | The second answer choice. |
| E | `Answer3` | Yes | The third answer choice. |
| F | `Answer4` | Yes | The fourth answer choice. |
| G | `CorrectAnswerKey` | Yes | A whole number from **0 to 3**, using the mapping below. |
| H | `Metadata` | No | Notes or other text to retain with the question. Leave blank when not needed. |
| I | `Pools` | No | One pool slug, such as `fabric-basics`, or several comma-separated slugs. |

The table shows the sample's column order. The importer matches columns by header name, so a different order is also accepted. The seven required columns must be present. `Metadata` and `Pools` may be blank or omitted entirely.

### Correct-answer numbering

**The answer key starts at zero, not one.**

| The correct choice is | Enter in `CorrectAnswerKey` |
| --------------------- | --------------------------- |
| `Answer1`             | `0`                         |
| `Answer2`             | `1`                         |
| `Answer3`             | `2`                         |
| `Answer4`             | `3`                         |

In the sample file, `DAX` is in `Answer2`, so its key is `1`.

If an existing question bank uses keys `1`, `2`, `3`, and `4`, subtract one from **every** key before importing. Changing only `4` to `3` would leave the other questions pointing at the wrong answers.

### Pools

A pool is a selectable collection of questions. Its **slug** is the value used in the CSV; its **name** is the label players see. For example, use slug `fabric-basics` and name `Fabric basics`.

Enter multiple slugs in one Excel cell as `fabric-basics,reporting`. Excel will quote that cell when saving the CSV. The importer trims whitespace, converts slugs to lowercase, and removes repeated slugs.

A blank or missing `Pools` value assigns the question to `default`. The import preview lists every destination, including `default`, and identifies missing display pools. Confirm their names and select the creation checkbox to save those pools together with the questions. Existing pools are never renamed or overwritten by an import.

### Metadata and additional columns

`Metadata` is stored as text. It can contain a note or JSON text if you need to retain several fields, for example:

```text
{"source":"https://learn.microsoft.com/fabric/onelake/onelake-overview","notes":"Introductory question"}
```

Enter that value in a single Excel cell. The app stores it under the question's `metadata.raw` field; it does not interpret the JSON or turn it into UI fields.

Columns other than the nine listed above are ignored. An external question ID, source URL, verification date, or evidence column is not imported automatically. Move any information you need to retain into `Metadata`. The application generates its own question IDs.

## 2. Save as CSV

1. Select the worksheet containing the questions.
2. Choose **Save As** or **Save a Copy** in Excel.
3. Select **CSV UTF-8, comma-delimited** and save the file with a `.csv` extension.
4. Accept Excel's prompt to save only the active sheet. Keep the `.xlsx` workbook separately if you need its other sheets or formatting.

Renaming an `.xlsx` file to `.csv` does not convert it. Open the saved file in a text editor and confirm that the header uses commas, as shown below. Semicolon-delimited exports are not supported.

The saved file starts with a header and then question rows:

```csv
Category,Question,Answer1,Answer2,Answer3,Answer4,CorrectAnswerKey,Metadata,Pools
Fabric,What is the unified data lake in Microsoft Fabric?,OneLake,Azure DevOps,Microsoft Teams,Excel,0,,fabric-basics
Power BI,Which language defines measures in Power BI?,HTML,DAX,PowerShell,CSS,1,,fabric-basics
```

When editing CSV directly, enclose a cell in double quotes if it contains commas, double quotes, or line breaks. Represent a double quote inside a quoted cell as `""`. For example, the raw CSV value for two pools is `"fabric-basics,reporting"`.

## 3. Create the pool and import

1. Open `https://<your-app-host>/operator` and sign in as the Fabric operator if prompted.
2. Select **Load questions and create pools**. Operator setup is available at `/operator`, not through an attendee-facing button.
3. Under **Import a CSV**, select the saved `.csv` file. To seed a new deployment with the bundled example, select **Use sample questions** instead.
4. Read **Import preview**. It shows the total question count, every destination slug, and the number of questions assigned to each pool. A question assigned to several pools counts once in the total and once under each destination.
5. For missing pools, enter the display names and select the checkbox to create them. For the sample, the slug is `fabric-basics`; use `Fabric basics` as its display name. These pools use the included default icon.
6. If the exact file was imported before, the page shows how many previous imports exist. Select **Add another copy of these questions** only when another additive import is intended.
7. Select **Import questions** and keep the tab open. Previewing a file or selecting the sample does not write data.
8. Wait for **Import complete** and confirm the accepted question count. The sample contains four questions. Missing pools and questions are saved in the same transaction.
9. Select **Back to attendee registration** to play.

Existing pools can be reused. Inactive destinations are identified in the preview; importing into them does not make them active. If there is only one active pool, the app selects it automatically for players.

The separate **Create a pool** form remains available when you want to set a description or choose an existing icon before importing. Use the same slug as the CSV. See [Pool artwork](operations.md#pool-artwork).

**Imports add questions; they do not replace existing questions.** Selecting a file again starts a new import. The duplicate warning compares exact file contents, including whitespace and line endings; it does not deduplicate questions across different files. Another copy requires explicit confirmation.

If a submission fails, use **Retry this import** without selecting the file again. A retry keeps the original import identity, CSV, pool definitions, and duplicate confirmation. It cannot add the same import twice. If another operator imported the file after your preview, the backend rejects an unconfirmed copy. Select **Review this import again** to refresh the preview and decide whether to add another copy.

### Calling the importer from code

Use the operator-authenticated Functions client. `previewQuestionImport` takes `importId` and `csv` and returns destination counts, existing pool details, and the number of previous completed imports with the same content and a different identifier.

`importQuestions` takes the same `importId` and `csv`, plus optional `poolsToCreate` and `allowDuplicateContent` values. Every requested pool must have a unique normalized slug referenced by the CSV. Pool creation is explicit, transactional, and never overwrites existing metadata. Only pools listed in `poolsToCreate` are created. Direct callers can import memberships without display records, but players cannot select those pools until the records exist. The operator page requires confirmation of missing display pools to avoid an empty selector.

`allowDuplicateContent` defaults to `false`. A fresh import identifier for previously imported content returns `DUPLICATE_IMPORT` unless this option is explicitly `true`. A replay of a completed import returns its original question identifiers without requiring another confirmation. Retain the complete request across retries.

## Limits and errors

| Rule | Limit or behavior |
| --- | --- |
| File size | At most 10 MiB, or 10,485,760 bytes |
| Question count | At least one question row |
| Required cells | Category, question, all four answers, and answer key must have values |
| Text length | At most 4,000 UTF-16 code units per category, question, answer, or metadata cell |
| Pool slug length | At most 400 UTF-16 code units per slug |
| Header names | Case-sensitive and unique |
| Row shape | Every question row must have the same number of cells as the header |
| Invalid data | The whole import is rejected; no partial question set is saved |
| Repeated content | A new import of the exact same file requires explicit confirmation |

For most ordinary text, one character is one UTF-16 code unit. Some characters, including many emoji, use two.

| Error | What to fix |
| --- | --- |
| Missing columns | Match the required header names and confirm the separator is a comma. |
| Expected a different number of columns | Check for unquoted commas, missing cells, or an incorrectly quoted value. |
| Answer key must be between 0 and 3 | Convert one-based keys to zero-based keys using the mapping above. |
| A required value is missing | Fill the named cell; whitespace alone does not count. |
| Text or file exceeds its limit | Shorten the affected field or split the source into smaller imports. |
| File has already been imported | Review the import again and confirm another copy only if intended. |

The game loads the selected pool's full question set at session start. Large pools take longer to load, even when each import is below the file-size limit.
