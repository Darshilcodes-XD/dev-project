import os


def test_controlled_fault_injection_switch():
    """The pipeline can trigger a genuine failing assertion to verify the deployment gate."""
    if os.getenv("PIPELINE_INJECT_FAILURE") == "1":
        assert False, "Controlled fault injection: the release gate must block this rollout."
    assert True
