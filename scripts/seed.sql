-- Creates only ExqlDemo. Never drops or modifies another database.
USE master;
IF DB_ID(N'ExqlDemo') IS NULL CREATE DATABASE ExqlDemo;
GO
USE ExqlDemo;
:r scripts/fixture.sql
