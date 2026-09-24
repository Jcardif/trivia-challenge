-- Run against the application-owned SQL database as an authorized administrator.
-- Use the application (client) ID, not the enterprise application's object ID.
DECLARE @clientId UNIQUEIDENTIFIER = '<application-client-id>';
DECLARE @sid VARBINARY(16) = CONVERT(VARBINARY(16), @clientId);

IF EXISTS (
    SELECT 1 FROM sys.database_principals
    WHERE [name] = N'trivia-sql-backend' AND ([sid] <> @sid OR [type] <> 'E')
)
    THROW 50000, 'trivia-sql-backend already identifies a different principal. Review its permissions before proceeding.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE [name] = N'trivia-sql-backend')
BEGIN
    DECLARE @createUser NVARCHAR(MAX) = N'CREATE USER [trivia-sql-backend] WITH SID = '
        + CONVERT(VARCHAR(MAX), @sid, 1) + N', TYPE = E;';
    EXEC (@createUser);
END;

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Players TO [trivia-sql-backend];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.PlayerEntryStates TO [trivia-sql-backend];
GRANT SELECT, INSERT ON OBJECT::dbo.QuestionPools TO [trivia-sql-backend];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.QuestionImports TO [trivia-sql-backend];
GRANT SELECT, INSERT ON OBJECT::dbo.Questions TO [trivia-sql-backend];
GRANT SELECT, INSERT ON OBJECT::dbo.QuestionPoolMemberships TO [trivia-sql-backend];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.GameSessions TO [trivia-sql-backend];
GRANT SELECT, INSERT ON OBJECT::dbo.SessionQuestions TO [trivia-sql-backend];
GRANT SELECT, INSERT ON OBJECT::dbo.GameSessionAnswers TO [trivia-sql-backend];
