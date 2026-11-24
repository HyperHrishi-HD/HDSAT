-- ----------------------------------------------------------------------------
-- REPORT STAT CORRECTION
-- ----------------------------------------------------------------------------
-- A report that turns out to be a real content defect must not leave the
-- reporter's score worse than it was. The operator resolves the report and,
-- with this function, removes the most recent attempt on that question from
-- the student's totals: user_stats, user_question_progress and the matching
-- daily_activity row. The question returns to "not attempted", so the student
-- can answer the corrected item again.
--
-- Deliberately explicit rather than automatic: dismissing a report must never
-- touch anyone's stats, so the console calls this only after deciding the item
-- itself was wrong. Coins and streak history are left alone; this corrects
-- accuracy, not rewards.
CREATE OR REPLACE FUNCTION public.admin_fix_report_stats(
    p_token TEXT,
    p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_report RECORD;
    v_progress RECORD;
    v_removed_correct INTEGER := 0;
    v_removed_unique INTEGER := 0;
BEGIN
    PERFORM public.assert_admin_unlocked(p_token);

    SELECT id, user_id, question_id, status
      INTO v_report
      FROM public.question_reports
     WHERE id = p_report_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report % does not exist', p_report_id;
    END IF;

    IF v_report.user_id IS NULL THEN
        -- The account was deleted under the right-to-erasure policy; there is
        -- no score left to correct, but the report is still resolved.
        UPDATE public.question_reports SET status = 'resolved' WHERE id = p_report_id;
        RETURN jsonb_build_object(
            'changed', FALSE,
            'message', 'This report has no linked account, so there is no score to correct.'
        );
    END IF;

    SELECT *
      INTO v_progress
      FROM public.user_question_progress
     WHERE user_id = v_report.user_id
       AND question_id = v_report.question_id
     FOR UPDATE;

    IF NOT FOUND THEN
        UPDATE public.question_reports SET status = 'resolved' WHERE id = p_report_id;
        RETURN jsonb_build_object(
            'changed', FALSE,
            'message', 'The reporter has no stored attempt on this question; nothing was removed.'
        );
    END IF;

    v_removed_correct := CASE WHEN v_progress.last_is_correct THEN 1 ELSE 0 END;
    v_removed_unique := CASE WHEN v_progress.attempt_count <= 1 THEN 1 ELSE 0 END;

    UPDATE public.user_stats
       SET total_attempts = GREATEST(total_attempts - 1, 0),
           correct_attempts = GREATEST(correct_attempts - v_removed_correct, 0),
           unique_questions_attempted = GREATEST(unique_questions_attempted - v_removed_unique, 0),
           updated_at = NOW()
     WHERE user_id = v_report.user_id;

    IF v_progress.last_attempted_at IS NOT NULL THEN
        -- The client sends its own local date with an attempt, so an evening
        -- answer on the American west coast can land on the next UTC day. Look
        -- one day either side and correct the nearest day that actually has
        -- activity, rather than silently missing the row.
        UPDATE public.daily_activity
           SET questions_completed = GREATEST(questions_completed - 1, 0),
               correct_questions = GREATEST(correct_questions - v_removed_correct, 0),
               updated_at = NOW()
         WHERE user_id = v_report.user_id
           AND activity_date = (
             SELECT d.activity_date
               FROM public.daily_activity d
              WHERE d.user_id = v_report.user_id
                AND d.activity_date BETWEEN (v_progress.last_attempted_at::DATE - 1)
                                        AND (v_progress.last_attempted_at::DATE + 1)
                AND d.questions_completed > 0
              ORDER BY ABS(d.activity_date - v_progress.last_attempted_at::DATE),
                       d.activity_date DESC
              LIMIT 1
         );
    END IF;

    IF v_progress.attempt_count <= 1 THEN
        DELETE FROM public.user_question_progress
         WHERE user_id = v_report.user_id
           AND question_id = v_report.question_id;
    ELSE
        -- The row still holds earlier work, but it does not remember the
        -- previous response, so the last-answer fields are cleared and the
        -- item is left as learning rather than claiming a false result.
        UPDATE public.user_question_progress
           SET attempt_count = GREATEST(attempt_count - 1, 0),
               correct_count = GREATEST(correct_count - v_removed_correct, 0),
               consecutive_correct = CASE
                   WHEN v_progress.last_is_correct THEN GREATEST(consecutive_correct - 1, 0)
                   ELSE 0
               END,
               status = 'attempted',
               last_response = '',
               last_is_correct = FALSE
         WHERE user_id = v_report.user_id
           AND question_id = v_report.question_id;
    END IF;

    UPDATE public.question_reports SET status = 'resolved' WHERE id = p_report_id;

    PERFORM public.refresh_streak_and_achievements(
        v_report.user_id,
        COALESCE(v_progress.last_attempted_at::DATE, CURRENT_DATE)
    );

    RETURN jsonb_build_object(
        'changed', TRUE,
        'attempts_removed', 1,
        'correct_removed', v_removed_correct,
        'message', 'Removed 1 attempt from the student''s score and accuracy.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fix_report_stats(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_fix_report_stats(TEXT, UUID) TO authenticated;
